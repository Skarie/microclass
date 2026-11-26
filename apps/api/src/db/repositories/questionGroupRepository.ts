/**
 * 题组（迁移 0029）的 SQL：组本身与组内成员的读写。
 *
 * 业务校验（标题长度、角色白名单、50 题上限、题目是否存在）都在
 * `services/questionGroupService`；这里只做无状态取数与写入，方便单独复用与保持在 200 行内。
 *
 * 时间字段沿用库里 TEXT（UTC），与 announcements / practice_links 一致；
 * 组内排序：母题（stem）永远在前，变式按 sort、再按加入顺序（sqlite rowid / pg question_id，方言 #28）排。
 *
 * P0 阶段 2（收尾批次）：改走 `AsyncDb`（PG 模式下不再落回 SQLite）。
 * 表达式类方言：`datetime('now')` → `nowText(driver)`（#26）；`INSERT` 取 id → `RETURNING id`（#14）；
 * int8 计数/水位统一 `Number()`（#17）。
 */
import type { AsyncDb } from '../async.js';
import { insertionOrder, likeCI, nowText } from '../sql.js';

/** 组内成员角色：母题 / 变式 */
export type QuestionGroupRole = 'stem' | 'variant';

export interface QuestionGroupRow {
  id: number;
  title: string;
  note: string;
  created_at: string;
  /** 最后变更时间（迁移 0030）：改组信息 / 加题 / 移题都会刷新 */
  updated_at: string;
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

/** 行 → 数字化（PG 的 bigint 经 node-postgres 默认是字符串，方言 #17） */
function toRow(raw: QuestionGroupRow): QuestionGroupRow {
  return { ...raw, id: Number(raw.id), created_by: raw.created_by === null ? null : Number(raw.created_by) };
}

const COLUMNS = 'id, title, note, created_at, updated_at, created_by';

export class QuestionGroupRepository {
  constructor(private readonly db: AsyncDb) {}

  /** 列表：标题/备注模糊搜，最新的在前；计数一次聚合出来，不做 N+1 查询 */
  async list(search: string): Promise<QuestionGroupListRow[]> {
    const like = `%${search}%`;
    // 关键词匹配用 likeCI（方言 #8/#23）：SQLite 的 LIKE 对 ASCII 大小写不敏感，PG 的不是，
    // 两边都写 `LOWER(列) LIKE LOWER(?)` 才能搜到同样的结果（中文不受影响）。
    const where = search === '' ? '' : ` WHERE ${likeCI('g.title')} OR ${likeCI('g.note')}`;
    const params = search === '' ? [] : [like, like];
    const rows = await this.db.all<QuestionGroupRow & { stemCount: number; variantCount: number; total: number }>(
      `SELECT g.id, g.title, g.note, g.created_at, g.updated_at, g.created_by,
              COALESCE(SUM(CASE WHEN i.role = 'stem' THEN 1 ELSE 0 END), 0) AS "stemCount",
              COALESCE(SUM(CASE WHEN i.role = 'variant' THEN 1 ELSE 0 END), 0) AS "variantCount",
              COUNT(i.question_id) AS total
         FROM question_groups g
         LEFT JOIN question_group_items i ON i.group_id = g.id${where}
        GROUP BY g.id
        ORDER BY g.updated_at DESC, g.id DESC`,
      params,
    );
    return rows.map((row) => ({
      ...toRow(row),
      stemCount: Number(row.stemCount ?? 0),
      variantCount: Number(row.variantCount ?? 0),
      total: Number(row.total ?? 0),
    }));
  }

  async findById(id: number): Promise<QuestionGroupRow | undefined> {
    const row = await this.db.get<QuestionGroupRow>(`SELECT ${COLUMNS} FROM question_groups WHERE id = ?`, [id]);
    return row ? toRow(row) : undefined;
  }

  async create(title: string, note: string, createdBy: number | null): Promise<number> {
    const row = await this.db.get<{ id: number | string }>(
      `INSERT INTO question_groups (title, note, created_by, updated_at)
       VALUES (?,?,?,${nowText(this.db.driver)}) RETURNING id`,
      [title, note, createdBy],
    );
    return Number(row?.id ?? 0);
  }

  async update(id: number, title: string, note: string): Promise<void> {
    await this.db.run(
      `UPDATE question_groups SET title = ?, note = ?, updated_at = ${nowText(this.db.driver)} WHERE id = ?`,
      [title, note, id],
    );
  }

  /** 组内成员变了（加题 / 移题 / 换角色）：刷新最后变更时间，列表排序才有意义 */
  async touch(id: number): Promise<void> {
    await this.db.run(`UPDATE question_groups SET updated_at = ${nowText(this.db.driver)} WHERE id = ?`, [id]);
  }

  /** 删除题组：items 由外键 ON DELETE CASCADE 带走 */
  async remove(id: number): Promise<void> {
    await this.db.run('DELETE FROM question_groups WHERE id = ?', [id]);
  }

  /** 组内题目：母题在前，变式按 sort；题干截断在服务层做 */
  async items(groupId: number): Promise<QuestionGroupItemRow[]> {
    const rows = await this.db.all<QuestionGroupItemRow>(
      `SELECT q.id, q.stem, q.type, COALESCE(q.difficulty, '') AS difficulty,
              i.role, i.sort
         FROM question_group_items i JOIN questions q ON q.id = i.question_id
        WHERE i.group_id = ?
        ORDER BY CASE WHEN i.role = 'stem' THEN 0 ELSE 1 END, i.sort, ${insertionOrder('i', this.db.driver)}`,
      [groupId],
    );
    return rows.map((row) => ({ ...row, id: Number(row.id), sort: Number(row.sort) }));
  }

  /** 组内已有成员：questionId → role（批量加入时判断「已存在则更新角色」） */
  async itemRoles(groupId: number): Promise<Map<number, QuestionGroupRole>> {
    const rows = await this.db.all<{ question_id: number | string; role: QuestionGroupRole }>(
      'SELECT question_id, role FROM question_group_items WHERE group_id = ?',
      [groupId],
    );
    return new Map(rows.map((row) => [Number(row.question_id), row.role]));
  }

  async countItems(groupId: number): Promise<number> {
    const row = await this.db.get<{ c: number | string }>(
      'SELECT COUNT(*) AS c FROM question_group_items WHERE group_id = ?',
      [groupId],
    );
    return Number(row?.c ?? 0);
  }

  /** 组内当前最大 sort（新加入的排到末尾，与已有顺序不打架） */
  async nextSort(groupId: number): Promise<number> {
    const row = await this.db.get<{ sort: number | string }>(
      'SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM question_group_items WHERE group_id = ?',
      [groupId],
    );
    return Number(row?.sort ?? 0);
  }

  /** 存在的题目 id（批量加入前统一校验，避免一道道查） */
  async existingQuestionIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(',');
    const rows = await this.db.all<{ id: number | string }>(`SELECT id FROM questions WHERE id IN (${marks})`, ids);
    return rows.map((row) => Number(row.id));
  }

  /** 加入（已存在则更新角色，保留原 sort —— 老师只是想换个角色） */
  async upsertItem(groupId: number, questionId: number, role: QuestionGroupRole, sort: number): Promise<void> {
    await this.db.run(
      `INSERT INTO question_group_items (group_id, question_id, role, sort) VALUES (?,?,?,?)
       ON CONFLICT(group_id, question_id) DO UPDATE SET role = excluded.role`,
      [groupId, questionId, role, sort],
    );
  }

  async removeItem(groupId: number, questionId: number): Promise<number> {
    const result = await this.db.run('DELETE FROM question_group_items WHERE group_id = ? AND question_id = ?', [
      groupId,
      questionId,
    ]);
    return result.changes;
  }

  /** 某道题所属的题组（按组名排序，便于稳定展示） */
  async groupsOfQuestion(questionId: number): Promise<QuestionGroupMembershipRow[]> {
    const rows = await this.db.all<QuestionGroupMembershipRow>(
      `SELECT g.id, g.title, i.role
         FROM question_group_items i JOIN question_groups g ON g.id = i.group_id
        WHERE i.question_id = ?
        ORDER BY g.title, g.id`,
      [questionId],
    );
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
  }

  /** 题目是否存在（加入成员前的校验） */
  async questionExists(id: number): Promise<boolean> {
    return (await this.db.get<{ id: number }>('SELECT id FROM questions WHERE id = ?', [id])) !== undefined;
  }
}
