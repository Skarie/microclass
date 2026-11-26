/**
 * 试卷编辑：加题 / 随机加题 / 配额组卷、改分值与大题、拖拽排序、保存结构、删题。
 *
 * 都是「写卷面」的动作，统一经由 `paperEdit` / `paperQuota` / `paperStructure` 落库；
 * 写成功后**主动失效共享卷面缓存**，避免交卷/成绩页在 15 秒 TTL 内按旧卷判分。
 *
 * P0 阶段 2（批次 2）：落库改走 AsyncDb（全部 `await`），缓存失效放在**写成功之后**。
 */
import type { QuestionType, User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import {
  addByQuota,
  addQuestions,
  addRandom,
  removeQuestion,
  reorder,
  setQuestionMeta,
  setStructure,
  type ExamPaperDeps,
} from './exam-paper.js';
import type { ExamPaperCache } from './exam-paper-cache.js';

export class ExamPaperEditService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
    private readonly paperCache: ExamPaperCache,
  ) {}

  private get paperDeps(): ExamPaperDeps {
    return { exams: this.exams, questions: this.questions, audit: this.audit };
  }

  async addQuestions(actor: User, examId: number, questionIds: number[]): Promise<number> {
    const added = await addQuestions(this.paperDeps, actor, examId, questionIds);
    this.paperCache.clearPaper(examId);
    return added;
  }

  /** 随机抽题：默认在课程题池内排除已选题目 */
  async addRandom(actor: User, examId: number, count: number): Promise<number> {
    const added = await addRandom(this.paperDeps, actor, examId, count);
    this.paperCache.clearPaper(examId);
    return added;
  }

  /** 按「题型配额 + 难度配额」组卷 */
  async addByQuota(
    actor: User,
    examId: number,
    quota: Partial<Record<QuestionType, number>>,
    difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
  ): Promise<{ added: number; requested: number; shortfall: number }> {
    const result = await addByQuota(this.paperDeps, actor, examId, quota, difficultyQuota);
    this.paperCache.clearPaper(examId);
    return result;
  }

  /** 改卷内某题的分值 / 大题分组 */
  async setQuestionMeta(
    actor: User,
    examId: number,
    questionId: number,
    meta: { score?: number; section?: string },
  ): Promise<void> {
    await setQuestionMeta(this.paperDeps, actor, examId, questionId, meta);
    this.paperCache.clearPaper(examId);
  }

  /** 重排卷内顺序（拖拽排序） */
  async reorder(actor: User, examId: number, questionIds: number[]): Promise<void> {
    await reorder(this.paperDeps, actor, examId, questionIds);
    this.paperCache.clearPaper(examId);
  }

  /** 保存试卷结构：大题分组 + 目标难度配比 + 总分 */
  async setStructure(
    actor: User,
    examId: number,
    sections: { name: string; type: string; score: number; description: string }[],
    difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
    totalScore?: number,
    applyScores = true,
  ): Promise<void> {
    await setStructure(this.paperDeps, actor, examId, sections, difficultyTarget, totalScore, applyScores);
    this.paperCache.clearPaper(examId);
  }

  async removeQuestion(actor: User, examId: number, questionId: number): Promise<void> {
    await removeQuestion(this.paperDeps, actor, examId, questionId);
    this.paperCache.clearPaper(examId);
  }
}
