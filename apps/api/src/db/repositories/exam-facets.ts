/**
 * 组卷选题树：册次 → 章节（带题量）、题型/难度/题库计数，以及知识点懒加载清单。
 *
 * 从 examRepository 抽出。条件统一走 `buildPickWhere()`（与题池同口径），
 * 计数会跟随题型/难度/关键词/排除已选题变化；
 * 空册次/空章节统一映射成哨兵值 `__none__`（树里显示成「未标注」），
 * 保证勾选后真的能筛出题。册次分组抽成纯函数 `groupFacetBooks()`。
 *
 * P0 阶段 2（批次 1）：只读查询，统一走 `AsyncDb`。
 */
import type { AsyncDb } from '../async.js';
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

/**
 * 分组键的 SQL 片段：**SELECT 与 GROUP BY 必须逐字相同**。
 *
 * PG 比 SQLite 严格得多（`GROUP BY` 只认「表达式本身/输入列」，不会替你把
 * `COALESCE(q.book, '')` 当作分组后的列），而 `GROUP BY book` 这种裸别名在 PG 里
 * 会先匹配**输入列** `q.book` —— 空串与 NULL 被分成两组，输出就出现两个同名册次。
 * 所以这里把键抽成常量，两处引用同一个字符串，两种库的结果与 SQLite 时代一致。
 */
const BOOK_KEY_SQL = `COALESCE(q.book, '')`;
const CHAPTER_KEY_SQL = `COALESCE(q.chapter, '')`;
const POINT_KEY_SQL = `COALESCE(q.point, '')`;

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
export async function facets(adb: AsyncDb, options: FacetsOptions): Promise<FacetsResult> {
  const scope: PickOptions = {
    ...(options.courseId === undefined ? {} : { courseId: options.courseId }),
    ...(options.types ? { types: options.types } : {}),
    ...(options.levels ? { levels: options.levels } : {}),
    ...(options.keyword ? { keyword: options.keyword } : {}),
    ...(options.books ? { books: options.books } : {}),
    ...(options.exclude && options.exclude.length > 0 ? { exclude: options.exclude } : {}),
  };
  const { where, params } = buildPickWhere(scope);
  const total = await pickCount(adb, scope);

  const rows = await adb.all<FacetBookRow>(
    `SELECT ${BOOK_KEY_SQL} AS book, ${CHAPTER_KEY_SQL} AS chapter, COUNT(*) AS n
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY ${BOOK_KEY_SQL}, ${CHAPTER_KEY_SQL}
     ORDER BY ${BOOK_KEY_SQL}, n DESC`,
    params,
  );

  const typeRows = await adb.all<{ type: string; n: number }>(
    `SELECT q.type AS type, COUNT(*) AS n FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY q.type ORDER BY n DESC`,
    params,
  );
  const levelRows = await adb.all<{ level: string; n: number }>(
    `SELECT ${DIFFICULTY_BUCKET_SQL} AS level, COUNT(*) AS n
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     GROUP BY ${DIFFICULTY_BUCKET_SQL}`,
    params,
  );
  /**
   * 题库维度：`b.name` 不参与分组（PG 直接报「column b.name must appear in the GROUP BY clause」，
   * 2.4.4 线上 500 的根因）。每个 bank_id 只对应一行 banks，用 MAX 取名字即可，
   * `LEFT JOIN` 失配时 MAX 为 NULL，再 COALESCE 成空串。
   */
  const bankRows = await adb.all<{ id: number; name: string; n: number }>(
    `SELECT q.bank_id AS id, COALESCE(MAX(b.name), '') AS name, COUNT(*) AS n
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
export async function pointsOf(adb: AsyncDb, options: PointsOfOptions): Promise<PointRow[]> {
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
  const rows = await adb.all<{ point: string; chapter: string; n: number }>(
    `SELECT ${POINT_KEY_SQL} AS point, ${CHAPTER_KEY_SQL} AS chapter, COUNT(*) AS n
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
       GROUP BY ${POINT_KEY_SQL}, ${CHAPTER_KEY_SQL} ORDER BY n DESC LIMIT ?`,
    [...params, limit],
  );
  return rows.map((r) => ({
    point: r.point || '__none__',
    label: r.point || '（未标注知识点）',
    chapter: r.chapter || '__none__',
    count: Number(r.n),
  }));
}
