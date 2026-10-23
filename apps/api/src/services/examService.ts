/**
 * 考试服务门面：对外方法签名与路由调用方式不变，职责按领域拆到同目录服务：
 *
 *  - `exam-lifecycle-service`    考试 CRUD、发布状态、列表与入参归一化
 *  - `exam-paper-workbench`      卷面视图/导出、细目表、智能组卷、换题候选与换题
 *  - `exam-paper-edit-service`   加题、随机/配额组卷、分值大题、排序、结构、删题
 *  - `exam-parallel-service`     平行卷（A/B 卷）
 *  - `exam-attempt-service`      取卷（时间窗/次数/乱序）与交卷判分落库审计
 *  - `exam-result-service`       我的成绩、全部成绩、成绩单与 CSV
 *  - `exam-paper-cache`          卷面 15 秒缓存（交卷与成绩页共享）
 *  - `exam-grade` / `exam-paper` / `exam-report` 既有领域模块
 *
 * 与 V1 的差异（均为修正）：V1 组卷查询漏了 `WHERE eq.exam_id = ?`，
 * 会把全库题目当作本卷题目；V2 严格按考试过滤。
 */
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { ExamRepository } from '../db/repositories/examRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import { ExamAttemptService } from './exam-attempt-service.js';
import { ExamLifecycleService } from './exam-lifecycle-service.js';
import { ExamPaperCache } from './exam-paper-cache.js';
import { ExamPaperEditService } from './exam-paper-edit-service.js';
import { ExamPaperWorkbench } from './exam-paper-workbench.js';
import { ExamParallelService } from './exam-parallel-service.js';
import { ExamResultService } from './exam-result-service.js';

export type { ExamDto } from './exam-lifecycle-service.js';
export type { ExamGradedItem, ExamSubmitResult } from './exam-grade.js';

export class ExamService {
  private readonly lifecycle: ExamLifecycleService;
  private readonly paperWorkbench: ExamPaperWorkbench;
  private readonly paperEditor: ExamPaperEditService;
  private readonly parallel: ExamParallelService;
  private readonly attempts: ExamAttemptService;
  private readonly results: ExamResultService;

  constructor(
    exams: ExamRepository,
    courses: CourseRepository,
    audit: AuditRepository,
    questions: QuestionRepository,
    media: QuestionMediaStore,
  ) {
    const paperCache = new ExamPaperCache(exams);
    this.lifecycle = new ExamLifecycleService(exams, courses, audit, paperCache);
    this.paperWorkbench = new ExamPaperWorkbench(exams, questions, audit, media, this.lifecycle);
    this.paperEditor = new ExamPaperEditService(exams, questions, audit, paperCache);
    this.parallel = new ExamParallelService(exams, questions, audit, this.lifecycle, this.paperEditor);
    this.attempts = new ExamAttemptService(exams, audit, paperCache, this.lifecycle);
    this.results = new ExamResultService(exams, paperCache, this.lifecycle);
  }

  readonly listForCourse = (...args: Parameters<ExamLifecycleService['listForCourse']>) =>
    this.lifecycle.listForCourse(...args);
  readonly findById = (...args: Parameters<ExamLifecycleService['findById']>) => this.lifecycle.findById(...args);
  readonly create = (...args: Parameters<ExamLifecycleService['create']>) => this.lifecycle.create(...args);
  readonly update = (...args: Parameters<ExamLifecycleService['update']>) => this.lifecycle.update(...args);
  readonly remove = (...args: Parameters<ExamLifecycleService['remove']>) => this.lifecycle.remove(...args);

  readonly paper = (...args: Parameters<ExamPaperWorkbench['paper']>) => this.paperWorkbench.paper(...args);
  readonly paperDocx = (...args: Parameters<ExamPaperWorkbench['paperDocx']>) => this.paperWorkbench.paperDocx(...args);
  readonly paperHtml = (...args: Parameters<ExamPaperWorkbench['paperHtml']>) => this.paperWorkbench.paperHtml(...args);
  readonly blueprint = (...args: Parameters<ExamPaperWorkbench['blueprint']>) => this.paperWorkbench.blueprint(...args);
  readonly autoCompose = (...args: Parameters<ExamPaperWorkbench['autoCompose']>) =>
    this.paperWorkbench.autoCompose(...args);
  readonly similarCandidates = (...args: Parameters<ExamPaperWorkbench['similarCandidates']>) =>
    this.paperWorkbench.similarCandidates(...args);
  readonly replaceWith = (...args: Parameters<ExamPaperWorkbench['replaceWith']>) =>
    this.paperWorkbench.replaceWith(...args);
  readonly taxonomy = (...args: Parameters<ExamPaperWorkbench['taxonomy']>) => this.paperWorkbench.taxonomy(...args);
  readonly replaceQuestion = (...args: Parameters<ExamPaperWorkbench['replaceQuestion']>) =>
    this.paperWorkbench.replaceQuestion(...args);

  readonly addQuestions = (...args: Parameters<ExamPaperEditService['addQuestions']>) =>
    this.paperEditor.addQuestions(...args);
  readonly addRandom = (...args: Parameters<ExamPaperEditService['addRandom']>) => this.paperEditor.addRandom(...args);
  readonly addByQuota = (...args: Parameters<ExamPaperEditService['addByQuota']>) =>
    this.paperEditor.addByQuota(...args);
  readonly setQuestionMeta = (...args: Parameters<ExamPaperEditService['setQuestionMeta']>) =>
    this.paperEditor.setQuestionMeta(...args);
  readonly reorder = (...args: Parameters<ExamPaperEditService['reorder']>) => this.paperEditor.reorder(...args);
  readonly setStructure = (...args: Parameters<ExamPaperEditService['setStructure']>) =>
    this.paperEditor.setStructure(...args);
  readonly removeQuestion = (...args: Parameters<ExamPaperEditService['removeQuestion']>) =>
    this.paperEditor.removeQuestion(...args);

  readonly parallelPaper = (...args: Parameters<ExamParallelService['parallelPaper']>) =>
    this.parallel.parallelPaper(...args);

  readonly take = (...args: Parameters<ExamAttemptService['take']>) => this.attempts.take(...args);
  readonly submit = (...args: Parameters<ExamAttemptService['submit']>) => this.attempts.submit(...args);

  readonly myResult = (...args: Parameters<ExamResultService['myResult']>) => this.results.myResult(...args);
  readonly scoreSheet = (...args: Parameters<ExamResultService['scoreSheet']>) => this.results.scoreSheet(...args);
  readonly scoreSheetCsv = (...args: Parameters<ExamResultService['scoreSheetCsv']>) =>
    this.results.scoreSheetCsv(...args);
  readonly myExams = (...args: Parameters<ExamResultService['myExams']>) => this.results.myExams(...args);
}
