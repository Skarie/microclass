/**
 * 题库文件夹（bank_folders）的 SQL：树数据、直属计数、未分类统计、课程汇总。
 *
 * 树形组装与业务校验在 `services/bankFolderService`；这里只做无状态的取数与写入，
 * 便于单独复用与保持在 300 行以内。
 *
 * P0 阶段 2（收尾批次）：改走 `AsyncDb`（PG 模式下不再落回 SQLite）。方言处理：
 *   - `parent_id IS ?` → `nullSafeEq(...)`（#27：PG 的 `IS` 只接受 NULL 字面量）；
 *   - `INSERT` 取 id → `RETURNING id`（#14）；
 *   - int8 的 id / 计数统一 `Number()`（#17）。
 */
import type { AsyncDb } from '../async.js';
import { nullSafeEq } from '../sql.js';

export interface BankFolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  created_at: string;
}

export interface FolderTotals {
  bankCount: number;
  questionCount: number;
}

export interface FolderDirectCount extends FolderTotals {
  folderId: number;
}

export interface CourseSummaryRow extends FolderTotals {
  courseId: number;
  name: string;
}

/** 行 → 数字化（PG 的 bigint 默认返回字符串，方言 #17） */
function toRow(row: BankFolderRow): BankFolderRow {
  return {
    ...row,
    id: Number(row.id),
    parent_id: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    sort: Number(row.sort ?? 0),
  };
}

/** 文件夹直属题库的聚合（题量取 banks.question_count 预计算列） */
async function directCounts(db: AsyncDb): Promise<FolderDirectCount[]> {
  const rows = await db.all<{ folderId: number | string; bankCount: number | string; questionCount: number | string }>(
    `SELECT folder_id AS "folderId", COUNT(*) AS "bankCount",
            COALESCE(SUM(question_count), 0) AS "questionCount"
       FROM banks
      WHERE folder_id IS NOT NULL
      GROUP BY folder_id`,
  );
  return rows.map((row) => ({
    folderId: Number(row.folderId),
    bankCount: Number(row.bankCount ?? 0),
    questionCount: Number(row.questionCount ?? 0),
  }));
}

/** SUM/COUNT 的结果在 PG 是字符串，统一收敛 */
function toTotals(row: FolderTotals | undefined): FolderTotals {
  return { bankCount: Number(row?.bankCount ?? 0), questionCount: Number(row?.questionCount ?? 0) };
}

export class BankFolderRepository {
  constructor(private readonly db: AsyncDb) {}

  async all(): Promise<BankFolderRow[]> {
    const rows = await this.db.all<BankFolderRow>('SELECT * FROM bank_folders ORDER BY sort, id');
    return rows.map(toRow);
  }

  async findById(id: number): Promise<BankFolderRow | undefined> {
    const row = await this.db.get<BankFolderRow>('SELECT * FROM bank_folders WHERE id = ?', [id]);
    return row ? toRow(row) : undefined;
  }

  /** 同级同名（parentId = NULL 也能正确匹配） */
  async findByParentAndName(parentId: number | null, name: string): Promise<BankFolderRow | undefined> {
    const row = await this.db.get<BankFolderRow>(
      `SELECT * FROM bank_folders WHERE ${nullSafeEq('parent_id', this.db.driver)} AND name = ?`,
      [parentId, name],
    );
    return row ? toRow(row) : undefined;
  }

  async directCounts(): Promise<FolderDirectCount[]> {
    return directCounts(this.db);
  }

  /** 未分类题库（folder_id IS NULL） */
  async unfiled(): Promise<FolderTotals> {
    const row = await this.db.get<FolderTotals>(
      `SELECT COUNT(*) AS "bankCount", COALESCE(SUM(question_count), 0) AS "questionCount"
         FROM banks WHERE folder_id IS NULL`,
    );
    return toTotals(row);
  }

  async childCount(id: number): Promise<number> {
    const row = await this.db.get<{ c: number | string }>(
      'SELECT COUNT(*) AS c FROM bank_folders WHERE parent_id = ?',
      [id],
    );
    return Number(row?.c ?? 0);
  }

  async bankCount(id: number): Promise<number> {
    const row = await this.db.get<{ c: number | string }>('SELECT COUNT(*) AS c FROM banks WHERE folder_id = ?', [id]);
    return Number(row?.c ?? 0);
  }

  /** 同级末尾的 sort（0 起；空目录返回 0） */
  async nextSort(parentId: number | null): Promise<number> {
    const row = await this.db.get<{ sort: number | string }>(
      `SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM bank_folders WHERE ${nullSafeEq('parent_id', this.db.driver)}`,
      [parentId],
    );
    return Number(row?.sort ?? 0);
  }

  async insert(parentId: number | null, name: string, sort: number): Promise<BankFolderRow> {
    const inserted = await this.db.get<{ id: number | string }>(
      'INSERT INTO bank_folders (parent_id, name, sort) VALUES (?,?,?) RETURNING id',
      [parentId, name, sort],
    );
    const row = await this.findById(Number(inserted?.id ?? 0));
    if (!row) throw new Error('文件夹创建失败');
    return row;
  }

  async update(id: number, patch: { name: string; parentId: number | null; sort: number }): Promise<BankFolderRow> {
    await this.db.run('UPDATE bank_folders SET name = ?, parent_id = ?, sort = ? WHERE id = ?', [
      patch.name,
      patch.parentId,
      patch.sort,
      id,
    ]);
    const row = await this.findById(id);
    if (!row) throw new Error('文件夹不存在');
    return row;
  }

  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM bank_folders WHERE id = ?', [id]);
  }

  /**
   * 课程关联视图的汇总：只统计挂了课程的题库，按课程名 / id 排序；
   * unbound 是未关联任何课程的题库合计。
   */
  async courseSummary(): Promise<{ courses: CourseSummaryRow[]; unbound: FolderTotals }> {
    const rows = await this.db.all<CourseSummaryRow>(
      `SELECT c.id AS "courseId", c.name,
              COUNT(*) AS "bankCount", COALESCE(SUM(b.question_count), 0) AS "questionCount"
         FROM banks b JOIN courses c ON c.id = b.course_id
        GROUP BY c.id
       HAVING COUNT(*) > 0
        ORDER BY c.name, c.id`,
    );
    const unbound = await this.db.get<FolderTotals>(
      `SELECT COUNT(*) AS "bankCount", COALESCE(SUM(question_count), 0) AS "questionCount"
           FROM banks WHERE course_id IS NULL`,
    );
    return {
      courses: rows.map((row) => ({ ...row, courseId: Number(row.courseId), ...toTotals(row) })),
      unbound: toTotals(unbound),
    };
  }
}
