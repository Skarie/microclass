/**
 * 自由标签服务（迁移 0030）：名称归一、重名 409、覆盖设置与批量打标。
 *
 * 产品语义：
 *   - 标签是**教研标记**（易错 / 高考真题 / 自编 / 需重录），和「知识点」是两条线：
 *     知识点回答「这题考什么」，标签回答「这题在教学上怎么用」；
 *   - 同名标签全局只允许一个（大小写不敏感、首尾空格忽略），避免「易错 / 易错 」并存；
 *   - 一道题可以打多个标签；批量打标支持 add（只加）/ remove（只删指定的）/ replace（整题覆盖）。
 *
 * 读接口登录即可，写接口教师 / 管理员（路由层守卫 + 这里兜底），写操作落审计。
 */
import { AppError, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { TagBatchMode, TagRepository, TagRow } from '../db/repositories/tagRepository.js';

/** 标签名上限：标签是短标记，太长在表里一行放不下 */
export const TAG_NAME_MAX = 40;
/** 标签备注上限 */
export const TAG_NOTE_MAX = 200;
/** 一次批量打标最多多少题（勾选整页 + 全选筛选结果都在这个量级内） */
export const TAG_BATCH_QUESTIONS_MAX = 2000;
/** 一次最多操作多少个标签 */
export const TAG_BATCH_TAGS_MAX = 50;

/** 查询串里的标签筛选模式：任意命中 / 同时包含 */
export type TagFilterMode = 'any' | 'all';

export interface TagItem {
  id: number;
  name: string;
  note: string;
  questionCount: number;
  createdAt: string;
}

export interface QuestionTagItem {
  id: number;
  name: string;
  note: string;
  createdAt: string;
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') throw AppError.badRequest('标签名必须是字符串');
  const name = raw.trim();
  if (name.length === 0) throw AppError.badRequest('标签名不能为空');
  if (name.length > TAG_NAME_MAX) throw AppError.badRequest(`标签名不能超过 ${TAG_NAME_MAX} 个字符`);
  return name;
}

function normalizeNote(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw AppError.badRequest('标签备注必须是字符串');
  if (raw.length > TAG_NOTE_MAX) throw AppError.badRequest(`标签备注不能超过 ${TAG_NOTE_MAX} 个字符`);
  return raw;
}

/** 标签 id 列表：去重、正整数、非空、最多 50 个 */
function parseTagIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw AppError.badRequest('tagIds 必须是数组');
  const ids: number[] = [];
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('tagIds 只能是正整数');
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > TAG_BATCH_TAGS_MAX) throw AppError.badRequest(`一次最多操作 ${TAG_BATCH_TAGS_MAX} 个标签`);
  return ids;
}

/** 题目 id 列表：去重、正整数、非空、最多 2000 个 */
function parseQuestionIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw AppError.badRequest('questionIds 必须是数组');
  const ids: number[] = [];
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('questionIds 只能是正整数');
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) throw AppError.badRequest('请至少选择一道题');
  if (ids.length > TAG_BATCH_QUESTIONS_MAX) {
    throw AppError.badRequest(`一次最多批量操作 ${TAG_BATCH_QUESTIONS_MAX} 道题`);
  }
  return ids;
}

export function normalizeTagMode(raw: unknown): TagFilterMode {
  return raw === 'all' ? 'all' : 'any';
}

export class TagService {
  constructor(
    private readonly tags: TagRepository,
    private readonly audit: AuditRepository,
  ) {}

  list(rawSearch: unknown): TagItem[] {
    const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, TAG_NAME_MAX) : '';
    return this.tags.list(search).map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note,
      questionCount: row.questionCount,
      createdAt: row.created_at,
    }));
  }

  create(actor: User, input: { name?: unknown; note?: unknown }): number {
    const name = normalizeName(input.name);
    const note = normalizeNote(input.note);
    if (this.tags.findByName(name)) throw AppError.conflict('已存在同名标签');
    const id = this.tags.create({ name, note, createdBy: actor.id });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'tag.create',
      targetType: 'tag',
      targetId: id,
      detail: { name, note },
    });
    return id;
  }

  update(actor: User, id: number, input: { name?: unknown; note?: unknown }): void {
    const row = this.requireRow(id);
    const name = input.name === undefined ? row.name : normalizeName(input.name);
    const note = input.note === undefined ? row.note : normalizeNote(input.note);
    const duplicate = this.tags.findByName(name);
    if (duplicate && duplicate.id !== id) throw AppError.conflict('已存在同名标签');
    this.tags.update(id, { name, note, createdBy: row.created_by });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'tag.update',
      targetType: 'tag',
      targetId: id,
      detail: { name, note },
    });
  }

  remove(actor: User, id: number): void {
    const row = this.requireRow(id);
    const questions = this.tags.countQuestions(id);
    this.tags.remove(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'tag.delete',
      targetType: 'tag',
      targetId: id,
      detail: { name: row.name, questions },
    });
  }

  /** 某道题当前标签（题目编辑弹窗回显） */
  ofQuestion(questionId: number): QuestionTagItem[] {
    if (!this.tags.existingQuestionIds([questionId]).includes(questionId)) throw AppError.notFound('题目不存在');
    return this.tags.tagsOfQuestion(questionId).map((row) => this.toQuestionTag(row));
  }

  /** 覆盖式设置某道题的标签（允许清空） */
  setQuestionTags(actor: User, questionId: number, rawTagIds: unknown): { affected: number } {
    if (!this.tags.existingQuestionIds([questionId]).includes(questionId)) throw AppError.notFound('题目不存在');
    const tagIds = parseTagIds(rawTagIds);
    this.requireTags(tagIds);
    this.tags.setQuestionTags(questionId, tagIds);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.tags.set',
      targetType: 'question',
      targetId: questionId,
      detail: { tagIds },
    });
    return { affected: 1 };
  }

  /** 批量打标：add / remove / replace，返回受影响的题目数 */
  batch(
    actor: User,
    input: { questionIds?: unknown; tagIds?: unknown; mode?: unknown },
  ): {
    affected: number;
    mode: TagBatchMode;
  } {
    const mode = input.mode === undefined ? 'add' : input.mode;
    if (mode !== 'add' && mode !== 'remove' && mode !== 'replace') {
      throw AppError.badRequest('mode 只能是 add / remove / replace');
    }
    const questionIds = parseQuestionIds(input.questionIds);
    const tagIds = parseTagIds(input.tagIds);
    if (questionIds.length !== this.tags.existingQuestionIds(questionIds).length) {
      throw AppError.badRequest('部分题目不存在或已被删除，请刷新后重试');
    }
    // replace 允许空标签（= 清空这些题的标签）；add / remove 必须至少给一个标签才有意义
    if (mode !== 'replace' && tagIds.length === 0) throw AppError.badRequest('请至少选择一个标签');
    this.requireTags(tagIds);
    const affected = this.tags.batch(questionIds, tagIds, mode);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.tags.batch',
      targetType: 'question',
      detail: { mode, questions: questionIds.length, tags: tagIds.length, affected },
    });
    return { affected, mode };
  }

  private requireRow(id: number): TagRow {
    const row = this.tags.findById(id);
    if (!row) throw AppError.notFound('标签不存在');
    return row;
  }

  private requireTags(tagIds: number[]): void {
    if (tagIds.length === 0) return;
    const found = this.tags.existingTagIds(tagIds);
    if (found.length !== tagIds.length) {
      const missing = tagIds.filter((id) => !found.includes(id)).slice(0, 5);
      throw AppError.badRequest(`标签不存在或已被删除：${missing.join(', ')}`);
    }
  }

  private toQuestionTag(row: TagRow): QuestionTagItem {
    return { id: row.id, name: row.name, note: row.note, createdAt: row.created_at };
  }
}
