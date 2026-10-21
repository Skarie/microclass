/**
 * 题目查询：题库内列表/分页/计数、按 id 取题、课时题、跨题库检索、难度样本读取。
 *
 * 从 questionRepository 抽出。SQL 文本、排序与分页语义逐字保持：
 * - 题库列表 `ORDER BY sort, id`，只有传了 page 才追加 LIMIT/OFFSET；
 * - 跨题库检索 `ORDER BY q.id`，limit 默认 30、上限 200；
 * - 筛选构造是**纯函数**（只产出 SQL 片段与参数），LIKE / IN 的值全部走占位符。
 */
import type { Question } from '@microclass/shared';
import type { Db } from '../client.js';
import type {
  QuestionFilter,
  QuestionPage,
  QuestionStemRow,
  QuestionWithBankName,
  SearchMetaOptions,
} from './question-types.js';
import { QUESTION_MEDIA_REF } from './question-types.js';

/** `IN (?,?,?)` 的占位符串（数量来自数组长度，不是用户输入） */
export function placeholders(count: number): string {
  return count <= 0 ? '' : new Array(count).fill('?').join(',');
}

/** 分页上限：参数缺失用默认值，越界收敛到 [1, max] */
export function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, raw ?? fallback));
}

/** 分页偏移：负数归零 */
export function clampOffset(raw: number | undefined): number {
  return Math.max(0, raw ?? 0);
}

/** 题目列表筛选 → ` AND ...` 片段（调用方已带 `WHERE bank_id = ?`） */
export function buildQuestionFilter(filter?: QuestionFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.type) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter?.difficulty) {
    clauses.push('difficulty = ?');
    params.push(filter.difficulty);
  }
  if (filter?.keyword) {
    clauses.push('(stem LIKE ? OR analysis LIKE ?)');
    const like = `%${filter.keyword}%`;
    params.push(like, like);
  }
  if (filter?.subject) {
    clauses.push('subject = ?');
    params.push(filter.subject);
  }
  if (filter?.stage) {
    clauses.push('stage = ?');
    params.push(filter.stage);
  }
  if (filter?.book) {
    clauses.push('book = ?');
    params.push(filter.book);
  }
  if (filter?.chapter) {
    clauses.push('chapter = ?');
    params.push(filter.chapter);
  }
  if (filter?.point) {
    clauses.push('point = ?');
    params.push(filter.point);
  }
  const imageLike = `%${QUESTION_MEDIA_REF}%`;
  if (filter?.hasImage === true) {
    clauses.push('(stem LIKE ? OR options LIKE ? OR analysis LIKE ?)');
    params.push(imageLike, imageLike, imageLike);
  }
  if (filter?.hasImage === false) {
    clauses.push('(stem NOT LIKE ? AND options NOT LIKE ? AND analysis NOT LIKE ?)');
    params.push(imageLike, imageLike, imageLike);
  }
  if (filter?.mediaOnlyAnalysis === true) {
    // 走部分索引 idx_questions_analysis_media_only，不再做字符串剥离
    clauses.push('analysis_media_only = 1');
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params };
}

/** 跨题库检索条件 → ` WHERE ...` 片段；列名来自固定键，值全部参数化 */
export function buildSearchClauses(options: SearchMetaOptions): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const key of ['subject', 'book', 'chapter', 'point', 'difficulty', 'type'] as const) {
    const value = options[key];
    if (value) {
      clauses.push(`q.${key} = ?`);
      params.push(value);
    }
  }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

/** 某题库的题目（可按题型/难度/关键字/元数据筛选） */
export function listByBank(db: Db, bankId: number, filter?: QuestionFilter, page?: QuestionPage): Question[] {
  const { sql, params } = buildQuestionFilter(filter);
  const paging = page ? ' LIMIT ? OFFSET ?' : '';
  const pagingParams = page ? [page.limit, page.offset] : [];
  return db.all<Question>(`SELECT * FROM questions WHERE bank_id = ?${sql} ORDER BY sort, id${paging}`, [
    bankId,
    ...params,
    ...pagingParams,
  ]);
}

/** 当前筛选条件下的题目总数（分页用） */
export function countByBank(db: Db, bankId: number, filter?: QuestionFilter): number {
  const { sql, params } = buildQuestionFilter(filter);
  return (
    db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?${sql}`, [bankId, ...params])?.c ?? 0
  );
}

export function findById(db: Db, id: number): Question | undefined {
  return db.get<Question>('SELECT * FROM questions WHERE id = ?', [id]);
}

export function findByIds(db: Db, ids: number[]): Question[] {
  if (ids.length === 0) return [];
  return db.all<Question>(`SELECT * FROM questions WHERE id IN (${placeholders(ids.length)})`, ids);
}

/** 课时可刷的题：题目直接挂课时，或题目所属题库挂课时 */
export function listByLesson(db: Db, lessonId: number): Question[] {
  return db.all<Question>(
    `SELECT q.* FROM questions q
     LEFT JOIN banks b ON b.id = q.bank_id
     WHERE q.lesson_id = ? OR b.lesson_id = ?
     ORDER BY q.sort, q.id`,
    [lessonId, lessonId],
  );
}

/** 跨题库检索（按知识点/书册/难度），带题库名便于展示 */
export function searchByMeta(db: Db, options: SearchMetaOptions): QuestionWithBankName[] {
  const { sql: where, params } = buildSearchClauses(options);
  const limit = clampLimit(options.limit, 30, 200);
  const offset = clampOffset(options.offset);
  return db.all<QuestionWithBankName>(
    `SELECT q.*, COALESCE(b.name, '') AS bank_name FROM questions q
     LEFT JOIN banks b ON b.id = q.bank_id${where}
     ORDER BY q.id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

/** 取几道题的题干与题库名（难度预览的样例题用，避免全量读大字段） */
export function stemsByIds(db: Db, ids: number[]): QuestionStemRow[] {
  if (ids.length === 0) return [];
  return db.all<QuestionStemRow>(
    `SELECT q.id, q.stem, COALESCE(b.name, '') AS bank_name FROM questions q
     LEFT JOIN banks b ON b.id = q.bank_id WHERE q.id IN (${placeholders(ids.length)})`,
    ids,
  );
}
