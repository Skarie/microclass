/**
 * 题库列表的 SQL：筛选条件、分页、单条详情（含文件夹路径 / 课程名 / 课时名）。
 *
 * 从 `bankRepository` 抽出：题库列表要 LEFT JOIN lessons / courses / 递归的
 * `bank_folders` 路径，SQL 比较长；放在独立模块后仓储文件保持在 300 行以内。
 */
import type { Db } from '../client.js';
import type { BankKind, BankRow } from './bankRepository.js';

/** 题库行 + 列表展示所需的派生字段 */
export interface BankWithStats extends BankRow {
  lesson_title: string;
  question_count: number;
  /** 归属文件夹；NULL = 未分类（迁移 0024） */
  folderId: number | null;
  /** 「必刷题 / 第一章」；未分类为空串 */
  folderPath: string;
  /** 归属课程名；未关联为空串 */
  courseName: string;
  /** 课时标题；未关联为空串 */
  lessonTitle: string;
}

export interface BankListFilter {
  lessonId?: number | null;
  kind?: BankKind;
  subject?: string;
  book?: string;
  /** 按名字模糊查（管理端搜索大题库用） */
  keyword?: string;
  /** 归属课程（含「未归属」用 `courseId: null`） */
  courseId?: number | null;
  /** 章节精确筛选；传空串 = 只看未分章（与「不传」区分） */
  section?: string;
  /** 文件夹直属筛选；`null` = 只看未分类（与「不传」区分） */
  folderId?: number | null;
  /** 分页：全库有 1.2 万个题库，一次全拉会把页面拖死 */
  limit?: number;
  offset?: number;
}

/** 递归拼文件夹路径；深度上限防御脏数据里的环 */
const FOLDER_PATH_CTE = `
WITH RECURSIVE folder_paths(id, path, depth) AS (
  SELECT id, name, 0 FROM bank_folders WHERE parent_id IS NULL
  UNION ALL
  SELECT f.id, fp.path || ' / ' || f.name, fp.depth + 1
  FROM bank_folders f JOIN folder_paths fp ON f.parent_id = fp.id
  WHERE fp.depth < 31
)`;

/** `banks` 列表的公共 SELECT（含文件夹路径 / 课程 / 课时） */
const BANK_SELECT = `
SELECT b.*, COALESCE(l.title, '') AS lesson_title, b.question_count,
       b.folder_id AS folderId, COALESCE(fp.path, '') AS folderPath,
       COALESCE(c.name, '') AS courseName, COALESCE(l.title, '') AS lessonTitle
FROM banks b
LEFT JOIN lessons l ON l.id = b.lesson_id
LEFT JOIN courses c ON c.id = b.course_id
LEFT JOIN folder_paths fp ON fp.id = b.folder_id`;

function bankWhere(options?: BankListFilter): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options?.lessonId === null) clauses.push('b.lesson_id IS NULL');
  else if (typeof options?.lessonId === 'number') {
    clauses.push('b.lesson_id = ?');
    params.push(options.lessonId);
  }
  if (options?.kind) {
    clauses.push('b.kind = ?');
    params.push(options.kind);
  }
  if (options?.subject) {
    clauses.push('b.subject = ?');
    params.push(options.subject);
  }
  if (options?.book) {
    clauses.push('b.book = ?');
    params.push(options.book);
  }
  if (options?.keyword) {
    clauses.push('b.name LIKE ?');
    params.push(`%${options.keyword}%`);
  }
  if (options?.courseId === null) clauses.push('b.course_id IS NULL');
  else if (typeof options?.courseId === 'number') {
    clauses.push('b.course_id = ?');
    params.push(options.courseId);
  }
  // 注意：空串是有意义的筛选值（未分章），不能用 if (value) 判断
  if (options?.section !== undefined) {
    clauses.push('b.section = ?');
    params.push(options.section);
  }
  if (options?.folderId === null) clauses.push('b.folder_id IS NULL');
  else if (typeof options?.folderId === 'number') {
    // 只看该文件夹**直属**题库：子文件夹里的通过各自的 folderId 查
    clauses.push('b.folder_id = ?');
    params.push(options.folderId);
  }
  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * 题库列表。**按 id 倒序（新建的排最前）**：
 * 真机有 1.2 万个题库、接口一次只取前 300 条，若按 id 升序，老师刚建的题库
 * 必然落在 300 条之外 —— 建完就"消失"（已踩过）。倒序后新建的立即可见。
 */
export function listBanks(db: Db, options?: BankListFilter): BankWithStats[] {
  const { where, params } = bankWhere(options);
  const limit = Math.min(1000, Math.max(1, options?.limit ?? 1000));
  const offset = Math.max(0, options?.offset ?? 0);
  return db.all<BankWithStats>(`${FOLDER_PATH_CTE} ${BANK_SELECT} ${where} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    limit,
    offset,
  ]);
}

/** 当前筛选条件下的题库总数（分页用） */
export function countBanks(db: Db, options?: BankListFilter): number {
  const { where, params } = bankWhere(options);
  return db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM banks b${where}`, params)?.c ?? 0;
}

/** 单条题库（详情用）：一次查齐派生字段，避免拉 1000 条再 filter */
export function findBankWithStats(db: Db, id: number): BankWithStats | undefined {
  return db.get<BankWithStats>(`${FOLDER_PATH_CTE} ${BANK_SELECT} WHERE b.id = ?`, [id]);
}
