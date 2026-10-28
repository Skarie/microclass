/**
 * 题库文件夹（bank_folders）的 SQL：树数据、直属计数、未分类统计、课程汇总。
 *
 * 树形组装与业务校验在 `services/bankFolderService`；这里只做无状态的取数与写入，
 * 便于单独复用与保持在 300 行以内。
 */
import type { Db } from '../client.js';

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

/** 文件夹直属题库的聚合（题量取 banks.question_count 预计算列） */
function directCounts(db: Db): FolderDirectCount[] {
  return db.all<FolderDirectCount>(
    `SELECT folder_id AS folderId, COUNT(*) AS bankCount,
            COALESCE(SUM(question_count), 0) AS questionCount
       FROM banks
      WHERE folder_id IS NOT NULL
      GROUP BY folder_id`,
  );
}

export class BankFolderRepository {
  constructor(private readonly db: Db) {}

  all(): BankFolderRow[] {
    return this.db.all<BankFolderRow>('SELECT * FROM bank_folders ORDER BY sort, id');
  }

  findById(id: number): BankFolderRow | undefined {
    return this.db.get<BankFolderRow>('SELECT * FROM bank_folders WHERE id = ?', [id]);
  }

  /** 同级同名（parentId = NULL 也能正确匹配） */
  findByParentAndName(parentId: number | null, name: string): BankFolderRow | undefined {
    return this.db.get<BankFolderRow>('SELECT * FROM bank_folders WHERE parent_id IS ? AND name = ?', [parentId, name]);
  }

  directCounts(): FolderDirectCount[] {
    return directCounts(this.db);
  }

  /** 未分类题库（folder_id IS NULL） */
  unfiled(): FolderTotals {
    return (
      this.db.get<FolderTotals>(
        `SELECT COUNT(*) AS bankCount, COALESCE(SUM(question_count), 0) AS questionCount
           FROM banks WHERE folder_id IS NULL`,
      ) ?? { bankCount: 0, questionCount: 0 }
    );
  }

  childCount(id: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bank_folders WHERE parent_id = ?', [id])?.c ?? 0;
  }

  bankCount(id: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM banks WHERE folder_id = ?', [id])?.c ?? 0;
  }

  /** 同级末尾的 sort（0 起；空目录返回 0） */
  nextSort(parentId: number | null): number {
    return (
      this.db.get<{ sort: number }>(
        'SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM bank_folders WHERE parent_id IS ?',
        [parentId],
      )?.sort ?? 0
    );
  }

  insert(parentId: number | null, name: string, sort: number): BankFolderRow {
    const id = this.db.run('INSERT INTO bank_folders (parent_id, name, sort) VALUES (?,?,?)', [
      parentId,
      name,
      sort,
    ]).lastInsertRowid;
    const row = this.findById(id);
    if (!row) throw new Error('文件夹创建失败');
    return row;
  }

  update(id: number, patch: { name: string; parentId: number | null; sort: number }): BankFolderRow {
    this.db.run('UPDATE bank_folders SET name = ?, parent_id = ?, sort = ? WHERE id = ?', [
      patch.name,
      patch.parentId,
      patch.sort,
      id,
    ]);
    const row = this.findById(id);
    if (!row) throw new Error('文件夹不存在');
    return row;
  }

  remove(id: number): void {
    this.db.run('DELETE FROM bank_folders WHERE id = ?', [id]);
  }

  /**
   * 课程关联视图的汇总：只统计挂了课程的题库，按课程名 / id 排序；
   * unbound 是未关联任何课程的题库合计。
   */
  courseSummary(): { courses: CourseSummaryRow[]; unbound: FolderTotals } {
    const courses = this.db.all<CourseSummaryRow>(
      `SELECT c.id AS courseId, c.name,
              COUNT(*) AS bankCount, COALESCE(SUM(b.question_count), 0) AS questionCount
         FROM banks b JOIN courses c ON c.id = b.course_id
        GROUP BY c.id
       HAVING COUNT(*) > 0
        ORDER BY c.name, c.id`,
    );
    const unbound = this.db.get<FolderTotals>(
      `SELECT COUNT(*) AS bankCount, COALESCE(SUM(question_count), 0) AS questionCount
           FROM banks WHERE course_id IS NULL`,
    ) ?? { bankCount: 0, questionCount: 0 };
    return { courses, unbound };
  }
}
