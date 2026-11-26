/**
 * 试卷编辑：加题 / 随机加题 / 配额组卷、改分值与大题、拖拽排序、保存结构、删题。
 *
 * 都是「写卷面」的动作，统一经由 `paperEdit` / `paperQuota` / `paperStructure` 落库；
 * 删题会让共享卷面缓存失效（其余动作维持重构前的失效时机不变）。
 *
 * P0 阶段 2（批次 1）：这些动作都以「校验考试存在 / 读题池」开头，读走 AsyncDb 后
 * 方法签名变为 async；**落库仍是同步写、事务边界不变**（批次 2 再迁）。
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
    return addQuestions(this.paperDeps, actor, examId, questionIds);
  }

  /** 随机抽题：默认在课程题池内排除已选题目 */
  async addRandom(actor: User, examId: number, count: number): Promise<number> {
    return addRandom(this.paperDeps, actor, examId, count);
  }

  /** 按「题型配额 + 难度配额」组卷 */
  async addByQuota(
    actor: User,
    examId: number,
    quota: Partial<Record<QuestionType, number>>,
    difficultyQuota?: Partial<Record<'easy' | 'medium' | 'hard', number>>,
  ): Promise<{ added: number; requested: number; shortfall: number }> {
    return addByQuota(this.paperDeps, actor, examId, quota, difficultyQuota);
  }

  /** 改卷内某题的分值 / 大题分组 */
  async setQuestionMeta(
    actor: User,
    examId: number,
    questionId: number,
    meta: { score?: number; section?: string },
  ): Promise<void> {
    await setQuestionMeta(this.paperDeps, actor, examId, questionId, meta);
  }

  /** 重排卷内顺序（拖拽排序） */
  async reorder(actor: User, examId: number, questionIds: number[]): Promise<void> {
    await reorder(this.paperDeps, actor, examId, questionIds);
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
  }

  async removeQuestion(actor: User, examId: number, questionId: number): Promise<void> {
    this.paperCache.clearPaper(examId);
    await removeQuestion(this.paperDeps, actor, examId, questionId);
  }
}
