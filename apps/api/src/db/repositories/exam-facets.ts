/**
 * 组卷选题树：册次 → 章节（带题量）、题型/难度/题库计数，以及知识点懒加载清单。
 *
 * 从 examRepository 抽出。条件统一走 `buildPickWhere()`（与题池同口径），
 * 计数会跟随题型/难度/关键词/排除已选题变化；
 * 空册次/空章节统一映射成哨兵值 `__none__`（树里显示成「未标注」），
 * 保证勾选后真的能筛出题。册次分组抽成纯函数 `groupFacetBooks()`。
 */
import type { Db } from '../client.js';
import { buildPickWhere, clampLimit, type PickOptions } from './exam-pool-filter.js';
import { pickCount } from './exam-pool.js';
import { DIFFICULTY_BUCKET_SQL } from './exam-types.js';

export interface FacetsOptions {
  courseId?: number;
  types?: string[];
  levels?: ('easy' | 'medium' | 'hard')[];
  keyword?: string;
  books?: string[];
  bankLimit?: number;
  /** 排除已在试卷里的题（让树里的计数与题池一致） */
  exclude?: number[];
}

export interface FacetBookRow {
  book: string;
  chapter: string;
  n: number;
}

export interface FacetBook {
  book: string;
  label: string;
  count: number;
  chapters: { chapter: string; label: string; count: number }[];
}

export interface FacetsResult {
  total: number;
  books: FacetBook[];
  types: { type: string; count: number }[];
  levels: { level: 'easy' | 'medium' | 'hard'; count: number }[];
  banks: { id: number; name: string; count: number }[];
}

/** 册次/章节分组行 → 册次节点（纯函数）：空值 → `__none__`，册次按题量倒序 */
export function groupFacetBooks(rows: FacetBookRow[]): FacetBook[] {
  const byBook = new Map<string, FacetBook>();
  for (const row of rows) {
    const bookKey = row.book || '__none__';
    const entry = byBook.get(bookKey) ?? {
      book: bookKey,
      label: row.book || '（未标注册次）',
      count: 0,
      chapters: [],
    };
    entry.chapters.push({
      chapter: row.chapter || '__none__',
      label: row.chapter || '（未标注章节）',
      count: Number(row.n),
    });
    entry.count += Number(row.n);
    byBook.set(bookKey, entry);
  }
  return [...byBook.values()].sort((a, b) => b.count - a.count);
}

/**
 * 选题树数据（册次 → 章节，带题量）：主流组卷系统左树就是这两层，
 * 「按教材章节命题」靠它。知识点太多（真机 5380 个）不整棵返回，
 * 由 `pointsOf()` 按册次/章节懒加载 + 搜索。
 *
 * 计数跟随题型/难度/关键词筛选变化：老师拖完筛选就能看到每章还剩多少题。
 */
export function facets(db: Db, options: FacetsOptions): FacetsResult {
  const scope: PickOptions = {
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
    ...(options.types ? { types: options.types } : {}),
    ...(options.levels ? { levels: options.levels } : {}),
    ...(options.keyword ? { keyword: options.keyword } : {}),
    ...(options.books ? { books: options.books } : {}),
    ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
  };
  const { where, params } = buildPickWhere(scope);
  const total = pickCount(db, scope);

  const rows = db.all<FacetBookRow>(
    `SELECT COALESCE(q.book, '') AS book, COALESCE(q.chapter, '') AS chapter, COUNT(*) AS n
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY q.book, q.chapter
     ORDER BY book, n DESC`,
    params,
  );

  const typeRows = db.all<{ type: string; n: number }>(
    `SELECT q.type AS type, COUNT(*) AS n FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY q.type ORDER BY n DESC`,
    params,
  );
  const levelRows = db.all<{ level: string; n: number }>(
    `SELECT ${DIFFICULTY_BUCKET_SQL} AS level, COUNT(*) AS n
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY level`,
    params,
  );
  const bankRows = db.all<{ id: number; name: string; n: number }>(
    `SELECT q.bank_id AS id, COALESCE(b.name, '') AS name, COUNT(*) AS n
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY q.bank_id ORDER BY n DESC LIMIT ?`,
    [...params, clampLimit(options.bankLimit, 50, 200)],
  );

  const levels: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
  return {
    total,
    books: groupFacetBooks(rows),
    types: typeRows.map((r) => ({ type: r.type, count: Number(r.n) })),
    levels: levels.map((level) => ({ level, count: Number(levelRows.find((r) => r.level === level)?.n ?? 0) })),
    banks: bankRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.n) })),
  };
}

export interface PointsOfOptions {
  courseId?: number;
  books?: string[];
  chapters?: string[];
  types?: string[];
  levels?: ('easy' | 'medium' | 'hard')[];
  keyword?: string;
  pointKeyword?: string;
  limit?: number;
  /** 排除已在试卷里的题 */
  exclude?: number[];
}

export interface PointRow {
  point: string;
  label: string;
  chapter: string;
  count: number;
}

/** 知识点清单 + 题量（知识点树懒加载 / 搜索用） */
export function pointsOf(db: Db, options: PointsOfOptions): PointRow[] {
  const { where, params } = buildPickWhere({
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
    ...(options.books ? { books: options.books } : {}),
    ...(options.chapters ? { chapters: options.chapters } : {}),
    ...(options.types ? { types: options.types } : {}),
    ...(options.levels ? { levels: options.levels } : {}),
    ...(options.keyword ? { keyword: options.keyword } : {}),
    ...(options.pointKeyword ? { point: options.pointKeyword } : {}),
    ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
  });
  const limit = clampLimit(options.limit, 200, 500);
  return db
    .all<{ point: string; chapter: string; n: number }>(
      `SELECT COALESCE(q.point, '') AS point, COALESCE(q.chapter, '') AS chapter, COUNT(*) AS n
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY q.point, q.chapter ORDER BY n DESC LIMIT ?`,
      [...params, limit],
    )
    .map((r) => ({
      point: r.point || '__none__',
      label: r.point || '（未标注知识点）',
      chapter: r.chapter || '__none__',
      count: Number(r.n),
    }));
}
