/** 题目 CRUD、批量操作、跨库检索与人工难度标注；输入校验统一走 bankQuestionInput。 */
import { AppError, type User } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionFilter, QuestionInput, QuestionRepository } from '../db/repositories/questionRepository.js';
import { scoreDifficulty } from '../domain/difficulty.js';
import { toViewer, type QuestionForViewer } from '../domain/questionView.js';
import type { QuestionDto } from './bankTypes.js';
import { prepareQuestionInput, questionRowToDto, type QuestionInputContext } from './bankQuestionInput.js';
import type { StorageService } from './storageService.js';

export class BankQuestionService {
  private readonly inputContext: QuestionInputContext;

  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    lessons: LessonRepository,
    storage: StorageService,
    private readonly audit: AuditRepository,
  ) {
    this.inputContext = { banks, lessons, storage };
  }

  listQuestions(
    bankId: number,
    filter?: QuestionFilter & { page?: number; pageSize?: number },
  ): {
    total: number;
    page: number;
    pageSize: number;
    questions: QuestionForViewer[];
  } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const page = Math.max(1, filter?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter?.pageSize ?? 50));
    const where: QuestionFilter = {
      ...(filter?.type ? { type: filter.type } : {}),
      ...(filter?.keyword ? { keyword: filter.keyword } : {}),
      ...(filter?.difficulty ? { difficulty: filter.difficulty } : {}),
      ...(filter?.chapter !== undefined ? { chapter: filter.chapter } : {}),
      ...(filter?.section !== undefined ? { section: filter.section } : {}),
      ...(filter?.mediaOnlyAnalysis === true ? { mediaOnlyAnalysis: true } : {}),
      ...(filter?.groupId !== undefined ? { groupId: filter.groupId } : {}),
      ...(filter?.tagIds && filter.tagIds.length > 0 ? { tagIds: filter.tagIds, tagMode: filter.tagMode } : {}),
      ...(filter?.points && filter.points.length > 0 ? { points: filter.points, pointMode: filter.pointMode } : {}),
    };
    const rows = this.questions.listByBank(bankId, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = this.questions.countByBank(bankId, where);
    return { total, page, pageSize, questions: rows.map((q) => toViewer(q, true)) };
  }

  /** 跨题库列表（高级检索：按标签 / 知识点 / 关键词找题，不限题库） */
  listQuestionsGlobal(filter?: QuestionFilter & { page?: number; pageSize?: number }): {
    total: number;
    page: number;
    pageSize: number;
    questions: QuestionForViewer[];
  } {
    const page = Math.max(1, filter?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter?.pageSize ?? 20));
    const where: QuestionFilter = {
      ...(filter?.type ? { type: filter.type } : {}),
      ...(filter?.keyword ? { keyword: filter.keyword } : {}),
      ...(filter?.difficulty ? { difficulty: filter.difficulty } : {}),
      ...(filter?.chapter !== undefined ? { chapter: filter.chapter } : {}),
      ...(filter?.section !== undefined ? { section: filter.section } : {}),
      ...(filter?.mediaOnlyAnalysis === true ? { mediaOnlyAnalysis: true } : {}),
      ...(filter?.groupId !== undefined ? { groupId: filter.groupId } : {}),
      ...(filter?.tagIds && filter.tagIds.length > 0 ? { tagIds: filter.tagIds, tagMode: filter.tagMode } : {}),
      ...(filter?.points && filter.points.length > 0 ? { points: filter.points, pointMode: filter.pointMode } : {}),
    };
    const rows = this.questions.listAll(where, { limit: pageSize, offset: (page - 1) * pageSize });
    return { total: this.questions.countAll(where), page, pageSize, questions: rows.map((q) => toViewer(q, true)) };
  }

  findQuestion(id: number) {
    return this.questions.findById(id);
  }

  createQuestion(actor: User, input: QuestionDto): number {
    const prepared = prepareQuestionInput(this.inputContext, input);
    const id = this.questions.create(prepared);
    this.markManualDifficulty(id, prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.create',
      targetType: 'question',
      targetId: id,
      detail: { bankId: prepared.bankId, type: prepared.type },
    });
    return id;
  }

  updateQuestion(actor: User, id: number, input: QuestionDto): void {
    const existing = this.questions.findById(id);
    if (!existing) throw AppError.notFound('题目不存在');
    // 未提交图片路径时保留原图
    const prepared = prepareQuestionInput(this.inputContext, {
      ...input,
      imagePath: input.imagePath ?? existing.image_path,
    });
    this.questions.update(id, prepared);
    this.markManualDifficulty(id, prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.update',
      targetType: 'question',
      targetId: id,
    });
  }

  /** 人工指定难度记为 manual（重算难度不覆盖），并按模型分与档位中点算参考分。 */
  private markManualDifficulty(id: number, prepared: QuestionInput): void {
    const difficulty = String(prepared.difficulty ?? '');
    if (!difficulty) return;
    const bank = this.banks.findById(prepared.bankId);
    const scored = scoreDifficulty({
      type: prepared.type,
      stem: prepared.stem,
      options: prepared.options,
      answer: prepared.answer,
      hasImage: Boolean(prepared.hasImage),
      subject: prepared.subject,
      stage: prepared.stage,
      book: prepared.book,
      chapter: prepared.chapter,
      point: prepared.point,
      bankKind: bank?.kind ?? '',
      bankName: bank?.name ?? '',
      legacyDifficulty: difficulty,
    });
    // 人工选的三档直接采用；分数取「模型分与该档区间中点」的均值，保证排序上也落在这一档
    const mid = difficulty === 'easy' ? 20 : difficulty === 'medium' ? 50 : 82;
    this.questions.setManualDifficulty(id, difficulty, Math.round((scored.score + mid) / 2));
  }

  removeQuestion(actor: User, id: number): void {
    const existing = this.questions.findById(id);
    if (!existing) throw AppError.notFound('题目不存在');
    this.questions.delete(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.delete',
      targetType: 'question',
      targetId: id,
    });
  }

  /**
   * 批量删除题目（多选后用）。
   * 只删**属于该题库**的 id，其它一律跳过（防止误传 id 跨库删除）。
   */
  removeQuestions(actor: User, bankId: number, ids: number[]): { deleted: number; skipped: number } {
    const inBank = this.questions
      .findByIds(ids)
      .filter((q) => q.bank_id === bankId)
      .map((q) => q.id);
    const deleted = this.questions.deleteMany(inBank);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.bulkDelete',
      targetType: 'question',
      targetId: bankId,
      detail: { count: deleted, ids: inBank.slice(0, 50) },
    });
    return { deleted, skipped: ids.length - inBank.length };
  }

  /** 批量改章节/小节（只影响该题库；两个字段都可单独传，空串表示清空） */
  setQuestionsSections(
    actor: User,
    bankId: number,
    ids: number[],
    patch: { chapter?: string; section?: string },
  ): { updated: number } {
    if (!this.banks.findById(bankId)) throw AppError.notFound('题库不存在');
    const normalize = (value: string | undefined): string | undefined =>
      value === undefined ? undefined : String(value).trim().slice(0, 120);
    const chapter = normalize(patch.chapter);
    const section = normalize(patch.section);
    const updated = this.questions.setSections(bankId, ids, {
      ...(chapter === undefined ? {} : { chapter }),
      ...(section === undefined ? {} : { section }),
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.updateSections',
      targetType: 'bank',
      targetId: bankId,
      detail: { updated, chapter, section, ids: ids.slice(0, 50) },
    });
    return { updated };
  }

  /** 批量设置难度（人工标注）：逐题走 updateQuestion，与单条编辑口径一致。 */
  setQuestionsDifficulty(
    actor: User,
    bankId: number,
    ids: number[],
    difficulty: 'easy' | 'medium' | 'hard',
  ): { updated: number; skipped: number } {
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const existing = this.questions.findById(id);
      if (!existing || existing.bank_id !== bankId) {
        skipped += 1;
        continue;
      }
      this.updateQuestion(actor, id, { ...questionRowToDto(existing), difficulty });
      updated += 1;
    }
    return { updated, skipped };
  }

  /** 跨题库按知识点/书册/难度找题（组卷与聚合浏览用） */
  searchQuestions(options: {
    subject?: string;
    book?: string;
    chapter?: string;
    point?: string;
    difficulty?: string;
    type?: string;
    page?: number;
    pageSize?: number;
  }): { page: number; pageSize: number; questions: unknown[]; points: unknown[] } {
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 30));
    const page = Math.max(1, options.page ?? 1);
    return {
      page,
      pageSize,
      questions: this.questions.searchByMeta({ ...options, limit: pageSize, offset: (page - 1) * pageSize }),
      points: this.questions.pointStats({
        ...(options.subject ? { subject: options.subject } : {}),
        ...(options.book ? { book: options.book } : {}),
        ...(options.point ? { point: options.point } : {}),
        limit: 20,
      }),
    };
  }
}
