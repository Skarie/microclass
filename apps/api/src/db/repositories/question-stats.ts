/**
 * 题目统计与聚合：体检计数、元数据覆盖率、按知识点聚合、难度分布。
 *
 * 从 questionRepository 抽出。SQL 保持「少扫表」的既有取舍：
 * - 体检的空值计数各走部分索引，不做一次全表 `SUM(CASE ...)`；
 * - 元数据覆盖率用「总数 − 空值数」（空值侧有部分索引）；
 * - 重复/冲突分组在 question-dedupe.ts（与去重共用同一条口径）；
 * - 难度分布一次复合分组后在 JS 汇总，汇总排序是纯函数 `summarizeDifficultyRows`。
 */
import type { Db } from '../client.js';
import { duplicateSummary } from './question-dedupe.js';
import { clampLimit } from './question-query.js';
import type {
  DifficultyLevelRow,
  DifficultyStats,
  DifficultyStatsCuts,
  PointStatRow,
  PointStatsOptions,
  QuestionHealth,
} from './question-types.js';

/**
 * 题库体检：全库（或某个题库）的标准化统计。
 * - 总量 / 难度缺失 / 答案为空 / 无配图 / 有配图（`has_image` 预计算列，不再 LIKE 全表扫描）
 * - 重复题：同 content_hash 出现多次（跨题库也能查出来）
 * - 答案冲突：同 content_hash 但答案不一致
 */
export function questionHealth(db: Db, bankId?: number): QuestionHealth {
  const scope = bankId === undefined ? '' : ' AND bank_id = ?';
  const params = bankId === undefined ? [] : [bankId];
  // 五个计数分开查，每条都能走索引：
  // 迁移 0014 给「空值列」建了部分索引（只存 = '' 的行，通常几十行），
  // 于是 difficulty/answer/content_hash 的空值统计变成走小索引；has_image 用既有索引；
  // COUNT(*) 只读主键/rowid。
  const countWhere = (where: string): number =>
    db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE ${where}${scope}`, params)?.c ?? 0;
  const base = {
    total: countWhere('1=1'),
    missingDifficulty: countWhere("difficulty = ''"),
    emptyAnswer: countWhere("answer = ''"),
    withImage: countWhere('has_image = 1'),
    mediaOnlyAnalysis: countWhere('analysis_media_only = 1'),
    noFingerprint: countWhere("content_hash = ''"),
  };
  const dup = duplicateSummary(db, bankId);
  const total = Number(base.total ?? 0);
  const withImage = Number(base.withImage ?? 0);
  return {
    total,
    missingDifficulty: Number(base.missingDifficulty ?? 0),
    emptyAnswer: Number(base.emptyAnswer ?? 0),
    withImage,
    withoutImage: total - withImage,
    mediaOnlyAnalysis: Number(base.mediaOnlyAnalysis ?? 0),
    duplicateGroups: Number(dup.groups ?? 0),
    duplicateQuestions: Number(dup.questions ?? 0),
    conflictGroups: Number(dup.conflicts ?? 0),
    noFingerprint: Number(base.noFingerprint ?? 0),
  };
}

/**
 * 元数据覆盖率：某一列非空的题目数（体检用）。
 *
 * 用「总数 − 空值数」而不是 `WHERE col <> ''`：空值那一侧有**部分索引**
 * （迁移 0014/0015，只存 `= ''` 的几十行），而 `<> ''` 没有任何索引可用 ——
 * 真机冷缓存实测一次 `<> ''` 统计要读完整库（500 秒级），体检页会像卡死。
 */
export function countByMeta(
  db: Db,
  bankId: number | undefined,
  column: 'subject' | 'book' | 'point' | 'content_hash',
  /**
   * 已知总数（体检已经算过 total 时传进来）——**省掉一次全表 COUNT(*)**。
   * 冷缓存下每次全表扫描都是几秒级，四个字段省 4 遍。
   */
  knownTotal?: number,
): number {
  const scope = bankId === undefined ? '' : ' AND bank_id = ?';
  const params = bankId === undefined ? [] : [bankId];
  const total =
    knownTotal ?? db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE 1=1${scope}`, params)?.c ?? 0;
  const empty =
    db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE ${column} = ''${scope}`, params)?.c ?? 0;
  return Math.max(0, total - empty);
}

/** 按知识点聚合统计（有多少题、难度分布、来自几个题库） */
export function pointStats(db: Db, options: PointStatsOptions): PointStatRow[] {
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
  return db.all<PointStatRow>(
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

/* ---------------- 难度分布（迁移 0016） ---------------- */

/** 复合分组行 → 对外统计结构（纯函数，不碰数据库） */
export function summarizeDifficultyRows(rows: DifficultyLevelRow[]): DifficultyStats {
  const total = rows.reduce((s, r) => s + Number(r.questions), 0);
  const unscored = rows.reduce((s, r) => (r.level === 0 ? s + Number(r.questions) : s), 0);
  const sumBy = (key: (r: DifficultyLevelRow) => string | number): Map<string | number, number> => {
    const m = new Map<string | number, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.questions));
    return m;
  };
  const bucketRows = [...sumBy((r) => r.difficulty)].map(([difficulty, questions]) => ({
    difficulty: String(difficulty),
    questions,
  }));
  bucketRows.sort((a, b) => b.questions - a.questions);
  const levelRows = [...sumBy((r) => r.level)]
    .map(([level, questions]) => ({ level: Number(level), questions }))
    .sort((a, b) => a.level - b.level);
  const sourceRows = [...sumBy((r) => r.source)]
    .map(([source, questions]) => ({ source: String(source), questions }))
    .sort((a, b) => b.questions - a.questions);
  const histogramRows = [...sumBy((r) => r.bucket)]
    .filter(([bucket]) => Number(bucket) >= 0)
    .map(([bucket, questions]) => ({ bucket: Number(bucket), questions }))
    .sort((a, b) => a.bucket - b.bucket);
  return {
    total,
    unscored,
    buckets: bucketRows,
    levels: levelRows,
    sources: sourceRows,
    histogram: histogramRows,
  };
}

/**
 * 难度分布与来源统计（体检 / 重算预览用）。
 * `cuts` 与落库时用的分档阈值一致，保证界面上的三档/五级与库里的 `difficulty` 完全对得上。
 *
 * **一次全表扫描**算出全部口径：按 (level, source, difficulty, bucket) 复合分组，
 * 结果集很小（≤ 6×5×5×10 行），再在 JS 里汇总。
 * 原来是 6 条独立的 COUNT/GROUP BY —— 冷缓存时就是 6 遍全表，体检页会像卡死（实测 69 秒）。
 */
export function difficultyStats(db: Db, bankId: number | undefined, cuts: DifficultyStatsCuts): DifficultyStats {
  const scope = bankId === undefined ? '' : ' AND bank_id = ?';
  const params = bankId === undefined ? [] : [bankId];
  const [p20, p40, p60, p80] = cuts.five;
  const rows = db.all<DifficultyLevelRow>(
    `SELECT CASE
              WHEN difficulty_score IS NULL OR difficulty_score < 0 THEN 0
              WHEN difficulty_score < ? THEN 1
              WHEN difficulty_score < ? THEN 2
              WHEN difficulty_score < ? THEN 3
              WHEN difficulty_score < ? THEN 4
              ELSE 5 END AS level,
            CASE WHEN difficulty_source IS NULL OR difficulty_source = '' THEN 'unknown' ELSE difficulty_source END AS source,
            COALESCE(difficulty, '') AS difficulty,
            CASE WHEN difficulty_score IS NULL OR difficulty_score < 0 THEN -1 ELSE CAST(difficulty_score / 10 AS INTEGER) END AS bucket,
            COUNT(*) AS questions
     FROM questions WHERE 1=1${scope}
     GROUP BY level, source, difficulty, bucket`,
    [p20, p40, p60, p80, ...params],
  );
  return summarizeDifficultyRows(rows);
}
