/**
 * 题组服务（迁移 0029）：母题 / 变式关联的校验、DTO 组装与审计。
 *
 * 产品语义（老师嘴里的说法）：
 *   - **题组** = 同一考点的「一道母题 + 若干变式」，组内顺序固定为「母题在前」；
 *   - 一道题可以同时属于多个题组，所以不往 questions 上加字段；
 *   - 一个题组最多 50 题（再多就不是「一组变式」而是一份专题卷了）。
 *
 * 读接口登录即可，写接口要求教师 / 管理员（路由层守卫 + 这里兜底），写操作落审计。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type {
  QuestionGroupListRow,
  QuestionGroupRepository,
  QuestionGroupRole,
  QuestionGroupRow,
} from '../db/repositories/questionGroupRepository.js';
import { stemSummary } from '../domain/stemSummary.js';

/** 组名长度上限（与路由 schema、前端 maxlength 一致） */
export const GROUP_TITLE_MAX = 100;
/** 备注上限 */
export const GROUP_NOTE_MAX = 2000;
/** 一个题组最多 50 题 */
export const GROUP_ITEMS_MAX = 50;
/** 详情里题干截断长度（保留 markdown 图片语法，见 stemSummary） */
const STEM_PREVIEW_MAX = 200;

const ROLES: readonly QuestionGroupRole[] = ['stem', 'variant'];

export interface GroupListItem {
  id: number;
  title: string;
  note: string;
  roleCounts: { stem: number; variant: number };
  total: number;
  /** 最后变更时间（迁移 0030）：改标题/备注、加题、移题都会刷新 */
  updatedAt: string;
}

export interface GroupQuestionItem {
  id: number;
  stem: string;
  type: string;
  difficulty: string;
  role: QuestionGroupRole;
  sort: number;
}

export interface GroupDetail extends GroupListItem {
  questions: GroupQuestionItem[];
}

export interface AddItemsResult {
  added: number;
  updated: number;
  total: number;
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw AppError.badRequest('题组标题必须是字符串');
  const title = raw.trim();
  if (title.length === 0) throw AppError.badRequest('题组标题不能为空');
  if (title.length > GROUP_TITLE_MAX) throw AppError.badRequest(`题组标题不能超过 ${GROUP_TITLE_MAX} 个字符`);
  return title;
}

function normalizeNote(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw AppError.badRequest('题组备注必须是字符串');
  if (raw.length > GROUP_NOTE_MAX) throw AppError.badRequest(`题组备注不能超过 ${GROUP_NOTE_MAX} 个字符`);
  return raw;
}

export function normalizeRole(raw: unknown): QuestionGroupRole {
  const role = ROLES.find((item) => item === raw);
  if (!role) throw AppError.badRequest('role 只能是 stem（母题）或 variant（变式）');
  return role;
}

function toListItem(row: QuestionGroupListRow): GroupListItem {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    roleCounts: { stem: row.stemCount, variant: row.variantCount },
    total: row.total,
    updatedAt: row.updated_at,
  };
}

export class QuestionGroupService {
  constructor(
    private readonly groups: QuestionGroupRepository,
    private readonly audit: AuditRepository,
  ) {}

  list(rawSearch: unknown): GroupListItem[] {
    const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, GROUP_TITLE_MAX) : '';
    return this.groups.list(search).map(toListItem);
  }

  detail(id: number): GroupDetail {
    const row = this.requireRow(id);
    const questions = this.groups.items(id).map((item) => ({
      id: item.id,
      stem: stemSummary(item.stem, STEM_PREVIEW_MAX),
      type: item.type,
      difficulty: item.difficulty,
      role: item.role,
      sort: item.sort,
    }));
    const stem = questions.filter((q) => q.role === 'stem').length;
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      roleCounts: { stem, variant: questions.length - stem },
      total: questions.length,
      updatedAt: row.updated_at,
      questions,
    };
  }

  create(actor: User, input: { title?: unknown; note?: unknown }): number {
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const id = this.groups.create(title, note, actor.id);
    this.writeAudit(actor, 'question_group.create', id, { title, note });
    return id;
  }

  update(actor: User, id: number, input: { title?: unknown; note?: unknown }): void {
    const row = this.requireRow(id);
    const title = input.title === undefined ? row.title : normalizeTitle(input.title);
    const note = input.note === undefined ? row.note : normalizeNote(input.note);
    this.groups.update(id, title, note);
    this.writeAudit(actor, 'question_group.update', id, { title, note });
  }

  remove(actor: User, id: number): void {
    const row = this.requireRow(id);
    const total = this.groups.countItems(id);
    this.groups.remove(id);
    this.writeAudit(actor, 'question_group.delete', id, { title: row.title, items: total });
  }

  /**
   * 批量加入：已存在的题只更新角色（不重复计数），新题追加到组内末尾。
   * 先整体校验再写库，避免「一半成功一半失败」的中间态。
   */
  addItems(actor: User, id: number, rawIds: unknown, rawRole: unknown): AddItemsResult {
    this.requireRow(id);
    const role = normalizeRole(rawRole);
    const ids = parseQuestionIds(rawIds);
    const existing = this.groups.existingQuestionIds(ids);
    if (existing.length !== ids.length) {
      const missing = ids.filter((qid) => !existing.includes(qid)).slice(0, 5);
      throw AppError.badRequest(`题目不存在或已被删除：${missing.join(', ')}`);
    }
    const current = this.groups.itemRoles(id);
    const fresh = ids.filter((qid) => !current.has(qid));
    if (current.size + fresh.length > GROUP_ITEMS_MAX) {
      throw AppError.badRequest(
        `一个题组最多 ${GROUP_ITEMS_MAX} 题，当前 ${current.size} 题，本次要新增 ${fresh.length} 题`,
      );
    }
    let sort = this.groups.nextSort(id);
    for (const questionId of ids) {
      this.groups.upsertItem(id, questionId, role, sort);
      if (!current.has(questionId)) sort += 1;
    }
    // 组内成员变了：刷新 updated_at（列表按它倒序）
    this.groups.touch(id);
    const updated = ids.length - fresh.length;
    this.writeAudit(actor, 'question_group.items.add', id, { count: ids.length, role, added: fresh.length });
    return { added: fresh.length, updated, total: this.groups.countItems(id) };
  }

  removeItem(actor: User, id: number, questionId: number): void {
    this.requireRow(id);
    if (!Number.isInteger(questionId) || questionId <= 0) throw AppError.badRequest('题目 id 非法');
    const changes = this.groups.removeItem(id, questionId);
    if (changes === 0) throw AppError.notFound('这道题不在该题组里');
    this.groups.touch(id);
    this.writeAudit(actor, 'question_group.items.remove', id, { questionId });
  }

  /** 题目 → 所属题组（题目详情弹窗）；题目不存在直接 404，避免前端把「无题组」当空态 */
  groupsOfQuestion(questionId: number): { id: number; title: string; role: QuestionGroupRole }[] {
    if (!this.groups.questionExists(questionId)) throw AppError.notFound('题目不存在');
    return this.groups.groupsOfQuestion(questionId);
  }

  private requireRow(id: number): QuestionGroupRow {
    const row = this.groups.findById(id);
    if (!row) throw AppError.notFound('题组不存在');
    return row;
  }

  private writeAudit(actor: User, action: string, id: number, detail: unknown): void {
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action,
      targetType: 'question_group',
      targetId: id,
      detail,
    });
  }
}

/** 批量题目 id：去重、只接受正整数、最多 GROUP_ITEMS_MAX 个 */
function parseQuestionIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw AppError.badRequest('questionIds 必须是数组');
  const ids: number[] = [];
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('questionIds 只能是正整数');
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) throw AppError.badRequest('请至少选择一道题');
  if (ids.length > GROUP_ITEMS_MAX) {
    throw AppError.badRequest(`一次最多加入 ${GROUP_ITEMS_MAX} 道题`);
  }
  return ids;
}
