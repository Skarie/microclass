/**
 * 试卷编辑：加题 / 随机加题 / 配额组卷、改分值与大题、拖拽排序、保存结构、删题。
 *
 * 都是「写卷面」的动作，统一经由 `paperEdit` / `paperQuota` / `paperStructure` 落库；
 * 删题会让共享卷面缓存失效（其余动作维持重构前的失效时机不变）。
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

  addQuestions(actor: User, examId: number, questionIds: number[]): number {
    return addQuestions(this.paperDeps, actor, examId, questionIds);
  }

  /** 随机抽题：默认在课程题池内排除已选题目 */
  addRandom(actor: User, examId: number, count: number): number {
    return addRandom(this.paperDeps, actor, examId, count);
  }

  /** 按「题型配额 + 难度配额」组卷 */
  addByQuota(
    actor: User,
    examId: number,
    quota: Partial<Record<QuestionType, number>>,
    difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
  ): { added: number; requested: number; shortfall: number } {
    return addByQuota(this.paperDeps, actor, examId, quota, difficultyQuota);
  }

  /** 改卷内某题的分值 / 大题分组 */
  setQuestionMeta(actor: User, examId: number, questionId: number, meta: { score?: number; section?: string }): void {
    setQuestionMeta(this.paperDeps, actor, examId, questionId, meta);
  }

  /** 重排卷内顺序（拖拽排序） */
  reorder(actor: User, examId: number, questionIds: number[]): void {
    reorder(this.paperDeps, actor, examId, questionIds);
  }

  /** 保存试卷结构：大题分组 + 目标难度配比 + 总分 */
  setStructure(
    actor: User,
    examId: number,
    sections: { name: string; type: string; score: number; description: string }[],
    difficultyTarget?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
    totalScore?: number,
    applyScores = true,
  ): void {
    setStructure(this.paperDeps, actor, examId, sections, difficultyTarget, totalScore, applyScores);
  }

  removeQuestion(actor: User, examId: number, questionId: number): void {
    this.paperCache.clearPaper(examId);
    removeQuestion(this.paperDeps, actor, examId, questionId);
  }
}
