/**
 * 组卷题池：挑题/计数/取 id、课程候选池、跨题库检索。
 *
 * 从 examRepository 抽出。SQL 文本、排序与分页语义逐字保持：
 * - pick 的条件全部来自 `buildPickWhere()`（纯函数），排序支持默认 id / 难度升 / 难度降；
 * - pick 的 limit 上限 400（平行组卷按题型批量取候选需要 min(400, …) 的窗口）；
 * - pickIds 上限 5000、默认 2000；pickCount 与 pick 条件完全一致；
 * - search 的 limit 上限 500、默认 50，`ORDER BY q.id`。
 *
 * P0 阶段 2（批次 1）：全部是只读查询，统一走 `AsyncDb`。
 * ⚠️ 方言 TODO：`q.point LIKE` / `q.chapter LIKE` / `q.stem LIKE` 依赖 SQLite 默认
 * 大小写不敏感（PG 的 LIKE 区分大小写，见 docs/postgres-migration.md §9 #8/#22）。
 */
import type { AsyncDb } from '../async.js';
import { buildPickWhere, clampLimit, clampOffset, type PickOptions } from './exam-pool-filter.js';
import type { PoolBudgetQuestion, PoolQuestion } from './exam-types.js';

/** pick() 返回行：题池展示需要的元数据 + 题库名 */
export type PickRow = PoolQuestion & {
  point: string;
  book: string;
  bank_name: string;
  difficulty_score: number;
};

/**
 * 挑题（组卷/选题的核心查询）。
 *
 * 注意：这里**不要加 DISTINCT**。`q.id` 是主键、`banks.id` 也是主键，
 * JOIN 不会产生重复行；而 DISTINCT 会强制 SQLite 先物化去重**整个**过滤结果集再 LIMIT，
 * 在 38 万题的库上代价很高（实测平行组卷因此到 5.2s）。
 */
export async function pick(adb: AsyncDb, options: PickOptions): Promise<PickRow[]> {
  const { where, params } = buildPickWhere(options);
  const order =
    options.orderBy === 'difficulty_asc'
      ? 'q.difficulty_score ASC, q.id'
      : options.orderBy === 'difficulty_desc'
        ? 'q.difficulty_score DESC, q.id'
        : 'q.id';
  // 上限 400：平行组卷按题型批量取候选时需要 min(400, …) 的窗口；
  // 这里若顶在 200 会把它静默砍半（曾导致匹配质量下降）。对外接口的 limit 由路由 schema 约束。
  const limit = clampLimit(options.limit, 20, 400);
  const offset = clampOffset(options.offset);
  return adb.all<PickRow>(
    `SELECT q.id, q.stem, q.type, q.bank_id, q.lesson_id, q.difficulty, q.subject, q.book, q.point,
            q.difficulty_score, COALESCE(b.name, '') AS bank_name
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

/** 符合筛选条件的全部题目 id（「全选筛选结果」用）；有上限保护，避免把几十万 id 传给前端 */
export async function pickIds(adb: AsyncDb, options: PickOptions & { cap?: number }): Promise<number[]> {
  const { where, params } = buildPickWhere(options);
  const cap = clampLimit(options.cap, 2000, 5000);
  const rows = await adb.all<{ id: number }>(
    `SELECT q.id FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where} ORDER BY q.id LIMIT ?`,
    [...params, cap],
  );
  return rows.map((r) => r.id);
}

/** 挑题总数（分页用；条件与 `pick` 完全一致） */
export async function pickCount(adb: AsyncDb, options: PickOptions): Promise<number> {
  const { where, params } = buildPickWhere(options);
  const row = await adb.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}`,
    params,
  );
  // PG 的 COUNT 是 int8，统一收成数字（方言 #17）
  return Number(row?.c ?? 0);
}

/** 课程范围内的候选题目（课时直属题目或课时所属题库的题目） */
export async function pool(adb: AsyncDb, courseId: number): Promise<PoolBudgetQuestion[]> {
  // 只给「随机增补 / 按配额组卷」用：它们只需要 id/type/difficulty，题干等大字段白读。
  // 课程范围与 pick() 对齐：题目归属课程 / 题库课时所属课程 / 题目课时所属课程
  //（前两项用迁移 0022 的冗余列走索引）。
  return adb.all<PoolBudgetQuestion>(
    `SELECT q.id, q.type, q.difficulty
     FROM questions q
     WHERE q.course_id = ?
        OR q.bank_lesson_course_id = ?
        OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
     ORDER BY q.id`,
    [courseId, courseId, courseId],
  );
}

/** 跨题库检索条件（按知识点/书册/难度） */
export interface SearchOptions {
  subject?: string;
  book?: string;
  chapter?: string;
  point?: string;
  difficulty?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

/**
 * 全库候选题（跨题库）——按知识点 / 书册 / 难度筛题用。
 * 不传任何条件时会扫全表，因此调用方必须带分页上限。
 */
export async function search(adb: AsyncDb, options: SearchOptions): Promise<PoolQuestion[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.subject) {
    clauses.push('q.subject = ?');
    params.push(options.subject);
  }
  if (options.book) {
    clauses.push('q.book = ?');
    params.push(options.book);
  }
  if (options.chapter) {
    clauses.push('q.chapter = ?');
    params.push(options.chapter);
  }
  if (options.point) {
    clauses.push('q.point = ?');
    params.push(options.point);
  }
  if (options.difficulty) {
    clauses.push('q.difficulty = ?');
    params.push(options.difficulty);
  }
  if (options.type) {
    clauses.push('q.type = ?');
    params.push(options.type);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = clampLimit(options.limit, 50, 500);
  const offset = clampOffset(options.offset);
  return adb.all<PoolQuestion>(
    `SELECT q.id, q.stem, q.type, q.bank_id, q.lesson_id, q.difficulty, q.subject, q.book, q.point, b.name AS bank_name
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id${where}
     ORDER BY q.id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}
