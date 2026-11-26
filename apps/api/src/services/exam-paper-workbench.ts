/**
 * 试卷工作台：卷面视图与导出、双向细目表、智能组卷、换题候选与按候选换题。
 *
 * 写操作（加题 / 随机加题 / 配额组卷 / 分值大题 / 排序 / 结构 / 删题）在
 * `exam-paper-edit-service`，平行卷（A/B 卷）在 `exam-parallel-service`。
 * 评审依赖仍以 `ExamPaperDeps` 显式传入，不读门面 `this`。
 *
 * P0 阶段 2（批次 2）：考试/卷面/细目表读取与组卷落库统一走 AsyncDb；
 * 写动作（智能组卷 / 换题）成功后会失效共享卷面缓存（交卷判分不能按旧卷）。
 */
import type { Exam, User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { PaperRenderOptions } from '../domain/paperHtml.js';
import type { QuestionForViewer } from '../domain/questionView.js';
import {
  autoCompose,
  buildBlueprint,
  paperView,
  replaceQuestion,
  replaceWith,
  similarCandidates,
  taxonomy,
  type AutoComposeInput,
  type AutoComposeResult,
  type BlueprintResult,
  type ExamPaperDeps,
  type SimilarCandidatesResult,
} from './exam-paper.js';
import type { ExamLifecycleService } from './exam-lifecycle-service.js';
import type { ExamPaperCache } from './exam-paper-cache.js';
import { buildPaperDocx, buildPaperHtml } from './exam-report.js';
import type { QuestionMediaStore } from './questionMediaStore.js';

export class ExamPaperWorkbench {
  constructor(
    private readonly exams: ExamRepository,
    private readonly questions: QuestionRepository,
    private readonly audit: AuditRepository,
    private readonly media: QuestionMediaStore,
    private readonly paperCache: ExamPaperCache,
    private readonly lifecycle: ExamLifecycleService,
  ) {}

  /** 组卷/结构/换题模块的显式依赖（模块不读 `this`） */
  private get paperDeps(): ExamPaperDeps {
    return { exams: this.exams, questions: this.questions, audit: this.audit };
  }

  /** 组卷视图：已选题目 + 卷面分值/大题 */
  async paper(examId: number): Promise<{
    exam: Exam;
    questions: QuestionForViewer[];
  }> {
    const exam = await this.lifecycle.findById(examId);
    return { exam, questions: paperView(await this.exams.listQuestions(examId)) };
  }

  /** 导出试卷 Word（.docx），可按需带答案解析 */
  async paperDocx(examId: number, options?: { withAnswers?: boolean }): Promise<{ filename: string; body: Buffer }> {
    const exam = await this.lifecycle.findById(examId);
    return buildPaperDocx(exam, await this.exams.listQuestions(examId), options, (file) => this.media.resolve(file));
  }

  /** 可打印试卷 HTML（A4/A3、横竖版、双栏、含答案、答题卡、密封线） */
  async paperHtml(examId: number, overrides?: Partial<PaperRenderOptions>): Promise<string> {
    const exam = await this.lifecycle.findById(examId);
    return buildPaperHtml(exam, await this.exams.listQuestions(examId), overrides);
  }

  /** 组卷工作台：卷面统计 + 双向细目表（知识点 × 题型 × 难度） */
  async blueprint(examId: number): Promise<BlueprintResult> {
    const exam = await this.lifecycle.findById(examId);
    return buildBlueprint(exam, await this.exams.listQuestions(examId));
  }

  /** 智能组卷（按题型配额 / 细目表逐格配题） */
  async autoCompose(actor: User, examId: number, input: AutoComposeInput): Promise<AutoComposeResult> {
    const result = await autoCompose(this.paperDeps, actor, examId, input);
    // 组卷写成功后失效卷面缓存：紧接着的交卷必须按新卷判分
    this.paperCache.clearPaper(examId);
    return result;
  }

  /** 换题候选（按匹配强度分组，不随机） */
  async similarCandidates(
    examId: number,
    questionId: number,
    options?: { limit?: number },
  ): Promise<SimilarCandidatesResult> {
    return similarCandidates(this.paperDeps, examId, questionId, options);
  }

  /** 用指定的题替换试卷里的某题 */
  async replaceWith(
    actor: User,
    examId: number,
    questionId: number,
    withId: number,
  ): Promise<{ ok: boolean; reason: string }> {
    const result = await replaceWith(this.paperDeps, actor, examId, questionId, withId);
    if (result.ok) this.paperCache.clearPaper(examId);
    return result;
  }

  /** 细目表参考数据：「知识点 × 题型 × 难度」各有多少可选题 */
  async taxonomy(options: { courseId?: number; scope?: 'course' | 'all'; limit?: number }): Promise<{
    scope: { mode: 'course' | 'all'; courseId: number | undefined };
    points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
    total: number;
  }> {
    return taxonomy(this.exams, options);
  }

  async replaceQuestion(
    actor: User,
    examId: number,
    questionId: number,
    options?: { point?: string; difficulty?: string },
  ): Promise<{ ok: boolean; replacedWith: number | null; reason: string }> {
    const result = await replaceQuestion(this.paperDeps, actor, examId, questionId, options);
    if (result.ok) this.paperCache.clearPaper(examId);
    return result;
  }
}
