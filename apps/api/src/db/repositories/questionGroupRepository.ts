/**
 * 题组（迁移 0029）的 SQL：组本身与组内成员的读写。
 *
 * 业务校验（标题长度、角色白名单、50 题上限、题目是否存在）都在
 * `services/questionGroupService`；这里只做无状态取数与写入，方便单独复用与保持在 200 行内。
 *
 * 时间字段沿用库里 TEXT（`datetime('now')`，UTC），与 announcements / practice_links 一致；
 * 组内排序：母题（stem）永远在前，变式按 sort、再按加入顺序（rowid）排。
 */
import type { Db } from '../client.js';

/** 组内成员角色：母题 / 变式 */
export type QuestionGroupRole = 'stem' | 'variant';

export interface QuestionGroupRow {
  id: number;
  title: string;
  note: string;
  created_at: string;
  created_by: number | null;
}

/** 列表行：组信息 + 角色计数（列表页直接显示「母题 N · 变式 M · 共 T」） */
export interface QuestionGroupListRow extends QuestionGroupRow {
  stemCount: number;
  variantCount: number;
  total: number;
}

/** 详情里的题目行：只取展示需要的列，避免把 answer / analysis 大字段读出来 */
export interface QuestionGroupItemRow {
  id: number;
  stem: string;
  type: string;
  difficulty: string;
  role: QuestionGroupRole;
  sort: number;
}

/** 题目 → 所属题组（题目详情弹窗的「所属题组」区域） */
export interface QuestionGroupMembershipRow {
  id: number;
  title: string;
  role: QuestionGroupRole;
}

export class QuestionGroupRepository {
  constructor(private readonly db: Db) {}

  /** 列表：标题/备注模糊搜，最新的在前；计数一次聚合出来，不做 N+1 查询 */
  list(search: string): QuestionGroupListRow[] {
    const like = `%${search}%`;
    const where = search === '' ? '' : ' WHERE g.title LIKE ? OR g.note LIKE ?';
    const params = search === '' ? [] : [like, like];
    const rows = this.db.all<QuestionGroupRow & { stemCount: number; variantCount: number; total: number }>(
      `SELECT g.id, g.title, g.note, g.created_at, g.created_by,
              COALESCE(SUM(CASE WHEN i.role = 'stem' THEN 1 ELSE 0 END), 0) AS stemCount,
              COALESCE(SUM(CASE WHEN i.role = 'variant' THEN 1 ELSE 0 END), 0) AS variantCount,
              COUNT(i.question_id) AS total
         FROM question_groups g
         LEFT JOIN question_group_items i ON i.group_id = g.id${where}
        GROUP BY g.id
        ORDER BY g.created_at DESC, g.id DESC`,
      params,
    );
    return rows.map((row) => ({
      ...row,
      stemCount: Number(row.stemCount ?? 0),
      variantCount: Number(row.variantCount ?? 0),
      total: Number(row.total ?? 0),
    }));
  }

  findById(id: number): QuestionGroupRow | undefined {
    return this.db.get<QuestionGroupRow>(
      'SELECT id, title, note, created_at, created_by FROM question_groups WHERE id = ?',
      [id],
    );
  }

  create(title: string, note: string, createdBy: number | null): number {
    return this.db.run('INSERT INTO question_groups (title, note, created_by) VALUES (?,?,?)', [title, note, createdBy])
      .lastInsertRowid;
  }

  update(id: number, title: string, note: string): void {
    this.db.run('UPDATE question_groups SET title = ?, note = ? WHERE id = ?', [title, note, id]);
  }

  /** 删除题组：items 由外键 ON DELETE CASCADE 带走 */
  remove(id: number): void {
    this.db.run('DELETE FROM question_groups WHERE id = ?', [id]);
  }

  /** 组内题目：母题在前，变式按 sort；题干截断在服务层做 */
  items(groupId: number): QuestionGroupItemRow[] {
    return this.db.all<QuestionGroupItemRow>(
      `SELECT q.id, q.stem, q.type, COALESCE(q.difficulty, '') AS difficulty,
              i.role, i.sort
         FROM question_group_items i JOIN questions q ON q.id = i.question_id
        WHERE i.group_id = ?
        ORDER BY CASE WHEN i.role = 'stem' THEN 0 ELSE 1 END, i.sort, i.rowid`,
      [groupId],
    );
  }

  /** 组内已有成员：questionId → role（批量加入时判断「已存在则更新角色」） */
  itemRoles(groupId: number): Map<number, QuestionGroupRole> {
    const rows = this.db.all<{ question_id: number; role: QuestionGroupRole }>(
      'SELECT question_id, role FROM question_group_items WHERE group_id = ?',
      [groupId],
    );
    return new Map(rows.map((row) => [row.question_id, row.role]));
  }

  countItems(groupId: number): number {
    return (
      this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question_group_items WHERE group_id = ?', [groupId])?.c ?? 0
    );
  }

  /** 组内当前最大 sort（新加入的排到末尾，与已有顺序不打架） */
  nextSort(groupId: number): number {
    return (
      this.db.get<{ sort: number }>(
        'SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM question_group_items WHERE group_id = ?',
        [groupId],
      )?.sort ?? 0
    );
  }

  /** 存在的题目 id（批量加入前统一校验，避免一道道查） */
  existingQuestionIds(ids: number[]): number[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    return this.db.all<{ id: number }>(`SELECT id FROM questions WHERE id IN (${marks})`, ids).map((row) => row.id);
  }

  /** 加入（已存在则更新角色，保留原 sort —— 老师只是想换个角色） */
  upsertItem(groupId: number, questionId: number, role: QuestionGroupRole, sort: number): void {
    this.db.run(
      `INSERT INTO question_group_items (group_id, question_id, role, sort) VALUES (?,?,?,?)
       ON CONFLICT(group_id, question_id) DO UPDATE SET role = excluded.role`,
      [groupId, questionId, role, sort],
    );
  }

  removeItem(groupId: number, questionId: number): number {
    return this.db.run('DELETE FROM question_group_items WHERE group_id = ? AND question_id = ?', [groupId, questionId])
      .changes;
  }

  /** 某道题所属的题组（按组名排序，便于稳定展示） */
  groupsOfQuestion(questionId: number): QuestionGroupMembershipRow[] {
    return this.db.all<QuestionGroupMembershipRow>(
      `SELECT g.id, g.title, i.role
         FROM question_group_items i JOIN question_groups g ON g.id = i.group_id
        WHERE i.question_id = ?
        ORDER BY g.title, g.id`,
      [questionId],
    );
  }

  /** 题目是否存在（加入成员前的校验） */
  questionExists(id: number): boolean {
    return this.db.get<{ id: number }>('SELECT id FROM questions WHERE id = ?', [id]) !== undefined;
  }
}
