/**
 * 组卷挑题的条件构造：pick / pickCount / pickIds / facets / pointsOf 共用。
 *
 * 从 examRepository 抽出。`buildPickWhere()` 是**纯函数**（只产出 SQL 片段与参数）：
 * - 所有用户输入只进参数，SQL 文本里不拼接值；
 * - 多选是精确 IN（树的勾选是「这个章节/知识点」，不能用 LIKE 子串），
 *   哨兵值 `__none__` 表示「未标注」，映射成空值/NULL；
 * - 条件顺序与拆分前逐字一致，保证 SQL 计划与结果稳定。
 */
import { DIFFICULTY_BUCKET_SQL } from './exam-types.js';

/** 挑题条件（pick / pickCount / pickIds 共用） */
export interface PickOptions {
  courseId?: number;
  lessonId?: number;
  bankId?: number;
  type?: string;
  difficulty?: string;
  levelMin?: number;
  levelMax?: number;
  point?: string;
  chapter?: string;
  /**
   * 多选范围（可跨章节/跨册）。**必须在这里显式声明**：
   * `pick()` 把 options 整体转给 `buildPickWhere()`，而调用方用 `...(cond ? { chapters } : {})`
   * 这种方式传参时 TS 的"多余属性检查"不生效 —— 漏声明不会报错，只会**静默丢掉范围**，
   * 结果就是"按章节随机组卷"变成全库乱抽（已踩过）。
   */
  books?: string[];
  /** 多选：教材章节（「按教材章节命题」用） */
  chapters?: string[];
  /** 多选：知识点（「按知识点命题」用） */
  points?: string[];
  /** 多选：题型 */
  types?: string[];
  /** 多选：难度档位（与 taxonomy 的口径一致：优先三档字段，旧数据按 difficulty_score 分档） */
  levels?: ('easy' | 'medium' | 'hard')[];
  keyword?: string;
  hasImage?: boolean;
  /**
   * 题组范围（迁移 0029）：只在某个题组内挑题。
   * 组是「母题 + 变式」的关联关系，不在 questions 上，所以走子查询而不是加列。
   */
  groupId?: number;
  /** 标签范围（迁移 0030）：命中任意 / 同时包含全部 */
  tagIds?: number[];
  tagMode?: 'any' | 'all';
  /** 排除已在试卷里的题 */
  exclude?: number[];
  /**
   * `error_desc`（易错题优先）不在 SQL 里排序 —— 错误率来自作答聚合、不在 questions 表里，
   * 由路由层取一个候选窗口后在内存里按威尔逊下界排。这里收下它只是为了类型统一。
   */
  orderBy?: 'default' | 'difficulty_asc' | 'difficulty_desc' | 'error_desc';
  limit?: number;
  offset?: number;
}

/** 分页上限：参数缺失用默认值，越界收敛到 [1, max] */
export function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, raw ?? fallback));
}

/** 分页偏移：负数归零 */
export function clampOffset(raw: number | undefined): number {
  return Math.max(0, raw ?? 0);
}

/** 挑题条件 → ` WHERE ...` 片段；列名固定、值全部参数化 */
export function buildPickWhere(options: PickOptions): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  /**
   * 精确多选（树的勾选是"这个章节/知识点"，不能用 LIKE 子串匹配）。
   * 哨兵值 `__none__` = 老师勾的是树里的「未标注」节点 → 匹配空值/ NULL。
   */
  const inClause = (column: string, values: string[] | undefined): void => {
    const list = (values ?? []).filter((v) => v !== '');
    if (list.length === 0) return;
    const real = list.filter((v) => v !== '__none__');
    const wantEmpty = list.includes('__none__');
    const parts: string[] = [];
    if (real.length > 0) {
      parts.push(`${column} IN (${real.map(() => '?').join(',')})`);
      params.push(...real);
    }
    if (wantEmpty) parts.push(`(${column} IS NULL OR ${column} = '')`);
    clauses.push(parts.length > 1 ? `(${parts.join(' OR ')})` : (parts[0] ?? '1 = 1'));
  };
  if (options.courseId !== undefined) {
    // 课程范围 = 题目所属题库的课程（q.course_id，迁移 0022 起冗余在题目行上，走索引）
    //           + 题目本身挂在课程课时下（q.lesson_id，走 idx_questions_lesson）
    //
    // 为什么不再关联 banks：原条件以 questions（37 万行）为驱动表逐行回查 banks 求值 OR，
    // 实测「本课程池」205ms；冗余列 + 两个可用索引后不再需要全表扫描。
    // banks.course_id 已由迁移与触发器保持与课时一致，语义不变。
    clauses.push(
      '(q.course_id = ? OR q.bank_lesson_course_id = ? OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?))',
    );
    params.push(options.courseId, options.courseId, options.courseId);
  }
  if (options.lessonId !== undefined) {
    clauses.push('(q.lesson_id = ? OR b.lesson_id = ?)');
    params.push(options.lessonId, options.lessonId);
  }
  if (options.bankId !== undefined) {
    clauses.push('q.bank_id = ?');
    params.push(options.bankId);
  }
  inClause('q.book', options.books);
  inClause('q.chapter', options.chapters);
  inClause('q.point', options.points);
  inClause('q.type', options.types);
  if (options.levels && options.levels.length > 0) {
    // 与 taxonomy()/掌握度完全同口径：优先三档字段，旧数据用 difficulty_score 按 42/71 分档
    clauses.push(`${DIFFICULTY_BUCKET_SQL} IN (${options.levels.map(() => '?').join(',')})`);
    params.push(...options.levels);
  }
  if (options.type) {
    clauses.push('q.type = ?');
    params.push(options.type);
  }
  if (options.difficulty) {
    clauses.push('q.difficulty = ?');
    params.push(options.difficulty);
  }
  if (options.levelMin !== undefined) {
    clauses.push('q.difficulty_score >= ?');
    params.push(options.levelMin);
  }
  if (options.levelMax !== undefined) {
    clauses.push('q.difficulty_score <= ?');
    params.push(options.levelMax);
  }
  if (options.point) {
    clauses.push('q.point LIKE ?');
    params.push(`%${options.point}%`);
  }
  if (options.chapter) {
    clauses.push('q.chapter LIKE ?');
    params.push(`%${options.chapter}%`);
  }
  if (options.keyword) {
    clauses.push('q.stem LIKE ?');
    params.push(`%${options.keyword}%`);
  }
  if (options.hasImage === true) clauses.push('q.has_image = 1');
  if (options.hasImage === false) clauses.push('q.has_image = 0');
  if (options.groupId !== undefined) {
    // 子查询走 question_group_items 主键（group_id 在最左列），只回题目 id
    clauses.push('q.id IN (SELECT question_id FROM question_group_items WHERE group_id = ?)');
    params.push(options.groupId);
  }
  /**
   * 标签筛选（迁移 0030）：与题库题目列表同一套语义 ——
   * any → IN；all → 子查询按题目分组 HAVING COUNT(DISTINCT tag_id) = N。
   */
  const tagIds = options.tagIds ?? [];
  if (tagIds.length > 0) {
    const marks = tagIds.map(() => '?').join(',');
    if (options.tagMode === 'all') {
      clauses.push(
        `q.id IN (SELECT question_id FROM question_tags WHERE tag_id IN (${marks})
                  GROUP BY question_id HAVING COUNT(DISTINCT tag_id) = ?)`,
      );
      params.push(...tagIds, tagIds.length);
    } else {
      clauses.push(`q.id IN (SELECT question_id FROM question_tags WHERE tag_id IN (${marks}))`);
      params.push(...tagIds);
    }
  }
  const exclude = options.exclude ?? [];
  if (exclude.length > 0) {
    clauses.push(`q.id NOT IN (${exclude.map(() => '?').join(',')})`);
    params.push(...exclude);
  }
  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}
