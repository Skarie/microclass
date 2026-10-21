/**
 * 组卷统计：细目表参考数据（知识点 × 题型 × 难度）与按知识点聚合的题目统计。
 *
 * 从 examRepository 抽出。难度档位统一走 `DIFFICULTY_BUCKET_SQL`（与挑题、选题树同口径）；
 * 行 → 知识点汇总抽成纯函数 `summarizeTaxonomy()`，便于单测锁住排序/分桶规则。
 */
import type { Db } from '../client.js';
import { clampLimit } from './exam-pool-filter.js';
import { DIFFICULTY_BUCKET_SQL } from './exam-types.js';

export interface TaxonomyOptions {
  courseId?: number;
  limit?: number;
}

export interface TaxonomyCell {
  type: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface TaxonomyPoint {
  point: string;
  total: number;
  cells: TaxonomyCell[];
}

/** 细目表 SQL 的复合分组行（point × type × difficulty bucket） */
export interface TaxonomyRow {
  point: string;
  type: string;
  bucket: string;
  n: number;
}

/**
 * 细目表行 → 按知识点汇总（纯函数）。
 *
 * 规则与拆分前逐字一致：
 * - 非 easy/hard 的 bucket 一律归 medium（旧数据没有分档时的兜底）；
 * - 同一个「知识点 × 题型」累加三档计数；
 * - 知识点按 total 倒序（稳定排序，同题量保留 SQL 返回顺序），再截 limit。
 */
export function summarizeTaxonomy(rows: TaxonomyRow[], limit: number): TaxonomyPoint[] {
  const byPoint = new Map<
    string,
    { point: string; total: number; cells: Map<string, { easy: number; medium: number; hard: number }> }
  >();
  for (const row of rows) {
    const entry = byPoint.get(row.point) ?? {
      point: row.point,
      total: 0,
      cells: new Map<string, { easy: number; medium: number; hard: number }>(),
    };
    const cell = entry.cells.get(row.type) ?? { easy: 0, medium: 0, hard: 0 };
    const bucket = row.bucket === 'easy' || row.bucket === 'hard' ? row.bucket : 'medium';
    cell[bucket] += row.n;
    entry.cells.set(row.type, cell);
    entry.total += row.n;
    byPoint.set(row.point, entry);
  }
  return [...byPoint.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((entry) => ({
      point: entry.point,
      total: entry.total,
      cells: [...entry.cells.entries()].map(([type, counts]) => ({ type, ...counts })),
    }));
}

/**
 * 细目表参考数据：「知识点 × 题型 × 难度」各有多少题。
 *
 * 难度档位与 `ExamService.blueprint` 口径一致：优先用三档字段，
 * 旧数据没有就用 `difficulty_score` 按 42/71 分档。
 */
export function taxonomy(db: Db, options: TaxonomyOptions): TaxonomyPoint[] {
  const where: string[] = ["q.point <> ''"];
  const params: unknown[] = [];
  if (options.courseId !== undefined) {
    where.push(
      `(b.course_id = ? OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
        OR q.bank_id IN (SELECT id FROM banks WHERE course_id = ?))`,
    );
    params.push(options.courseId, options.courseId, options.courseId);
  }
  const rows = db.all<TaxonomyRow>(
    `SELECT q.point AS point,
            q.type AS type,
            ${DIFFICULTY_BUCKET_SQL} AS bucket,
            COUNT(*) AS n
     FROM questions q
     LEFT JOIN banks b ON b.id = q.bank_id
     WHERE ${where.join(' AND ')}
     GROUP BY q.point, q.type, bucket
     ORDER BY n DESC`,
    params,
  );
  return summarizeTaxonomy(rows, clampLimit(options.limit, 200, 500));
}

export interface PointStatsOptions {
  subject?: string;
  book?: string;
  point?: string;
  limit?: number;
}

export interface PointStatsRow {
  subject: string;
  book: string;
  point: string;
  questions: number;
  easy: number;
  medium: number;
  hard: number;
  banks: number;
}

/** 按知识点聚合的题目统计（一个知识点有多少题、难度分布、来自几个题库） */
export function pointStats(db: Db, options: PointStatsOptions): PointStatsRow[] {
  const clauses: string[] = ["q.point <> ''"];
  const params: unknown[] = [];
  if (options.subject) {
    clauses.push('q.subject = ?');
    params.push(options.subject);
  }
  if (options.book) {
    clauses.push('q.book = ?');
    params.push(options.book);
  }
  if (options.point) {
    clauses.push('q.point LIKE ?');
    params.push(`%${options.point}%`);
  }
  const limit = clampLimit(options.limit, 50, 500);
  return db.all<PointStatsRow>(
    `SELECT q.subject, q.book, q.point, COUNT(*) AS questions,
            SUM(CASE WHEN q.difficulty = 'easy' THEN 1 ELSE 0 END) AS easy,
            SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END) AS medium,
            SUM(CASE WHEN q.difficulty = 'hard' THEN 1 ELSE 0 END) AS hard,
            COUNT(DISTINCT q.bank_id) AS banks
     FROM questions q WHERE ${clauses.join(' AND ')}
     GROUP BY q.subject, q.book, q.point
     ORDER BY questions DESC LIMIT ?`,
    [...params, limit],
  );
}
