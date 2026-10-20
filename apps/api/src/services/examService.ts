/**
 * 考试服务：对外编排（组卷 / 限时作答 / 交卷判分 / 成绩单）。
 *
 * 具体职责拆到三个模块，本类只负责取数、调用与审计：
 *  - `exam-grade`  —— 纯判分（无 DB / 无 Fastify，可单测直接调）
 *  - `exam-paper`  —— 组卷、试卷结构、换题/删题
 *  - `exam-report` —— 成绩单、打印 HTML、试卷 Word、CSV
 *
 * 与 V1 的差异（均为修正）：V1 组卷查询漏了 `WHERE eq.exam_id = ?`，
 * 会把全库题目当作本卷题目；V2 严格按考试过滤。
 */
import { AppError, type Exam, type QuestionType, type User } from '@microclass/shared';
import type { ExamAttempt, ExamRepository, ExamWithStats } from '../db/repositories/examRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { QuestionForViewer } from './bankService.js';
import { toViewer } from './bankService.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import { shuffle } from './quizService.js';
import type { PaperRenderOptions } from '../domain/paperHtml.js';
import { gradeSubmission, slimResults, type ExamGradedItem, type ExamSubmitResult } from './exam-grade.js';
import {
  addByQuota,
  addQuestions,
  addRandom,
  autoCompose,
  buildBlueprint,
  matchParallelQuestions,
  paperView,
  removeQuestion,
  reorder,
  replaceQuestion,
  replaceWith,
  setQuestionMeta,
  setStructure,
  similarCandidates,
  taxonomy,
  type AutoComposeInput,
  type AutoComposeResult,
  type BlueprintResult,
  type ExamPaperDeps,
  type SimilarCandidatesResult,
} from './exam-paper.js';
import {
  buildMyResult,
  buildPaperDocx,
  buildPaperHtml,
  buildScoreSheet,
  buildScoreSheetCsv,
  type MyResult,
  type ScoreSheet,
} from './exam-report.js';

export type { ExamGradedItem, ExamSubmitResult };

export interface ExamDto {
  courseId: number;
  title: string;
  description?: string;
  durationMinutes?: number;
  passScore?: number;
  status?: Exam['status'];
  /** 考试设置（对标学习通）：时间窗口 / 作答次数 / 题目乱序 / 交卷后公布答案 */
  startAt?: number;
  endAt?: number;
  attemptLimit?: number;
  shuffleQuestions?: boolean;
  showAnswers?: boolean;
}

export class ExamService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
    /** 换题时要校验"要换上的题"确实存在，因此需要题库仓储 */
    private readonly questions: QuestionRepository,
    /** 试卷导出 Word 时要内联题图（与题库导出同一套工具） */
    private readonly media: QuestionMediaStore,
  ) {}

  /** 组卷/结构/换题模块的显式依赖（模块不读 `this`） */
  private get paperDeps(): ExamPaperDeps {
    return { exams: this.exams, questions: this.questions, audit: this.audit };
  }

  /**
   * 卷面缓存：交卷时不再每次重读整卷。
   *
   * 起因：压测里 1064 题的卷、60 人同时交卷要 7 秒 —— 慢的不是判分（纯内存计算），
   * 而是每次提交都 `listQuestions` 读 1064 行（含题干/选项/解析），60 次就是 6.4 万行。
   * 卷面在考试期间只读，缓存 60 秒足够；改卷/换题/删除时主动失效。
   */
  private readonly paperCache = new Map<number, { rows: ReturnType<ExamRepository['listQuestions']>; at: number }>();
  private static readonly PAPER_TTL_MS = 15_000;

  private paperOf(examId: number): ReturnType<ExamRepository['listQuestions']> {
    const hit = this.paperCache.get(examId);
    const now = Date.now();
    if (hit && now - hit.at < ExamService.PAPER_TTL_MS) return hit.rows;
    const rows = this.exams.listQuestions(examId);
    if (this.paperCache.size > 300) this.paperCache.clear();
    this.paperCache.set(examId, { rows, at: now });
    return rows;
  }

  /** 卷面变更后失效（改卷、删除、换题时调用） */
  private clearPaper(examId: number): void {
    this.paperCache.delete(examId);
  }

  /** 课程下的考试列表；学生只看已发布，且带自己的最近成绩 */
  listForCourse(viewer: User, courseId: number): { course: { id: number; name: string }; exams: unknown[] } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    const exams = this.exams
      .listByCourseWithStats(courseId, isManager ? null : viewer.id)
      .filter((e) => isManager || e.status === 'published')
      .map((e: ExamWithStats & { my: ExamAttempt | null }) => ({
        ...e,
        qcount: e.question_count,
        my: e.my
          ? {
              score: e.my.score,
              total: e.my.total,
              passed: e.my.passed,
              used_seconds: e.my.used_seconds,
              created_at: e.my.created_at,
            }
          : null,
      }));
    return { course: { id: course.id, name: course.name }, exams };
  }

  findById(examId: number): Exam {
    const exam = this.exams.findById(examId);
    if (!exam) throw AppError.notFound('考试不存在');
    return exam;
  }

  create(actor: User, input: ExamDto): number {
    const prepared = this.prepare(input);
    const id = this.exams.create(prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.create',
      targetType: 'exam',
      targetId: id,
      detail: { courseId: prepared.courseId, title: prepared.title },
    });
    return id;
  }

  update(actor: User, examId: number, input: ExamDto): void {
    this.findById(examId);
    this.clearPaper(examId);
    const prepared = this.prepare(input);
    this.exams.update(examId, prepared);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.update',
      targetType: 'exam',
      targetId: examId,
    });
  }

  remove(actor: User, examId: number): void {
    const exam = this.findById(examId);
    this.clearPaper(examId);
    this.exams.delete(examId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.delete',
      targetType: 'exam',
      targetId: examId,
      detail: { title: exam.title },
    });
  }

  /** 组卷视图：已选题目 + 卷面分值/大题 */
  paper(examId: number): {
    exam: Exam;
    questions: QuestionForViewer[];
  } {
    const exam = this.findById(examId);
    return { exam, questions: paperView(this.exams.listQuestions(examId)) };
  }

  /** 导出试卷 Word（.docx），可按需带答案解析 */
  paperDocx(examId: number, options?: { withAnswers?: boolean }): { filename: string; body: Buffer } {
    const exam = this.findById(examId);
    return buildPaperDocx(exam, this.exams.listQuestions(examId), options, (file) => this.media.resolve(file));
  }

  /** 组卷工作台：卷面统计 + 双向细目表（知识点 × 题型 × 难度） */
  blueprint(examId: number): BlueprintResult {
    const exam = this.findById(examId);
    return buildBlueprint(exam, this.exams.listQuestions(examId));
  }

  /** 智能组卷（按题型配额 / 细目表逐格配题） */
  autoCompose(actor: User, examId: number, input: AutoComposeInput): AutoComposeResult {
    return autoCompose(this.paperDeps, actor, examId, input);
  }

  /**
   * 平行组卷（A/B 卷）：按原卷逐题配「同题型、同难度档、知识点尽量相同」的不同题，
   * 生成一场新考试，并沿用原卷的分值、大题、考试设置与试卷结构。
   */
  parallelPaper(
    actor: User,
    examId: number,
    input: { title?: string; scope?: 'course' | 'all'; replaceExisting?: boolean } = {},
  ): {
    examId: number;
    title: string;
    requested: number;
    matched: number;
    shortfall: number;
    detail: { index: number; type: string; level: string; point: string; from: number; to: number | null }[];
  } {
    const source = this.findById(examId);
    const questions = this.exams.listQuestions(examId);
    if (questions.length === 0) throw AppError.badRequest('原卷里还没有题目，无法生成平行卷');

    const scope: 'course' | 'all' = input.scope === 'all' ? 'all' : 'course';
    const scopeCourseId = scope === 'all' ? undefined : source.course_id;

    const newId = this.create(actor, {
      courseId: source.course_id,
      title: (input.title ?? '').trim() !== '' ? String(input.title) : `${source.title}（平行卷）`,
      description: source.description,
      durationMinutes: source.duration_minutes,
      passScore: source.pass_score,
      status: 'draft',
      startAt: Number(source.start_at ?? 0),
      endAt: Number(source.end_at ?? 0),
      attemptLimit: Number(source.attempt_limit ?? 0),
      shuffleQuestions: Number(source.shuffle_questions ?? 0) === 1,
      showAnswers: Number(source.show_answers ?? 1) === 1,
    });
    if (input.replaceExisting) this.exams.clearQuestions(newId);
    // 沿用原卷的试卷结构与目标配比（分值也在下面逐题抄）
    this.exams.setStructure(
      newId,
      String(source.structure ?? '[]'),
      String(source.difficulty_target ?? ''),
      Number(source.total_score ?? 100),
    );

    const { pickedIds, pairs, detail } = matchParallelQuestions(this.paperDeps, questions, scopeCourseId);
    if (pickedIds.length > 0) this.addQuestions(actor, newId, pickedIds);
    // 逐题沿用分值与大题（第 i 道新题对应原卷第 i 道题）
    pairs.forEach(({ picked, from }) => {
      this.setQuestionMeta(actor, newId, picked, {
        score: Number(from.score ?? 0),
        section: String(from.section ?? ''),
      });
    });

    return {
      examId: newId,
      title: this.findById(newId).title,
      requested: questions.length,
      matched: pickedIds.length,
      shortfall: questions.length - pickedIds.length,
      detail,
    };
  }

  /** 换题候选（按匹配强度分组，不随机） */
  similarCandidates(examId: number, questionId: number, options?: { limit?: number }): SimilarCandidatesResult {
    return similarCandidates(this.paperDeps, examId, questionId, options);
  }

  /** 用指定的题替换试卷里的某题 */
  replaceWith(actor: User, examId: number, questionId: number, withId: number): { ok: boolean; reason: string } {
    return replaceWith(this.paperDeps, actor, examId, questionId, withId);
  }

  /** 细目表参考数据：「知识点 × 题型 × 难度」各有多少可选题 */
  taxonomy(options: { courseId?: number; scope?: 'course' | 'all'; limit?: number }): {
    scope: { mode: 'course' | 'all'; courseId: number | undefined };
    points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
    total: number;
  } {
    return taxonomy(this.exams, options);
  }

  replaceQuestion(
    actor: User,
    examId: number,
    questionId: number,
    options?: { point?: string; difficulty?: string },
  ): { ok: boolean; replacedWith: number | null; reason: string } {
    return replaceQuestion(this.paperDeps, actor, examId, questionId, options);
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
    this.clearPaper(examId);
    removeQuestion(this.paperDeps, actor, examId, questionId);
  }

  /** 取卷作答：已交卷返回 already，未发布仅管理端可见 */
  take(
    viewer: User,
    examId: number,
  ): {
    already: boolean;
    exam: Partial<Exam>;
    questions?: QuestionForViewer[];
    total?: number;
  } {
    const exam = this.findById(examId);
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    if (exam.status !== 'published' && !isManager) throw AppError.notFound('考试未发布');
    // 考试设置（学员才受限；老师随时可以查看卷子）
    if (!isManager) {
      const now = Math.floor(Date.now() / 1000);
      const startAt = Number(exam.start_at ?? 0);
      const endAt = Number(exam.end_at ?? 0);
      if (startAt > 0 && now < startAt) throw AppError.badRequest('考试还没开始，请到考试时间再作答');
      if (endAt > 0 && now > endAt) throw AppError.badRequest('考试已结束，不能再作答');
      const limit = Number(exam.attempt_limit ?? 0);
      if (limit > 0) {
        const used = this.exams.attemptCount(examId, viewer.id);
        if (used >= limit) throw AppError.badRequest(`本场考试允许作答 ${limit} 次，已用完`);
      }
    }
    const previous = this.exams.findAttempt(examId, viewer.id);
    const questions = this.exams.listQuestions(examId).map((q) =>
      toViewer(
        {
          id: q.id,
          bank_id: q.bank_id,
          lesson_id: q.lesson_id,
          type: q.type as QuestionType,
          stem: q.stem,
          image_path: q.image_path,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          sort: q.sort,
          created_at: 0,
          difficulty: q.difficulty ?? '',
        },
        isManager,
      ),
    );
    if (previous) {
      return { already: true, exam: { id: exam.id, title: exam.title, pass_score: exam.pass_score } };
    }
    // 题目乱序（学习通里的"题目顺序随机"）：只打乱展示顺序，判分仍然按题号
    const ordered = exam.shuffle_questions ? shuffle(questions) : questions;
    return {
      already: false,
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration_minutes: exam.duration_minutes,
        pass_score: exam.pass_score,
        show_answers: Number(exam.show_answers ?? 1) === 1 ? 1 : 0,
      },
      questions: ordered,
      total: ordered.length,
    };
  }

  /** 交卷：一次性作答，重复交卷被拒；用时上限为限时 + 30 秒缓冲 */
  submit(
    viewer: User,
    examId: number,
    answers: { qid: number; answer: string }[],
    startedAt?: number,
  ): ExamSubmitResult {
    const exam = this.findById(examId);
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    if (exam.status !== 'published' && !isManager) throw AppError.notFound('考试未发布');
    if (this.exams.findAttempt(examId, viewer.id)) throw AppError.badRequest('本场考试已交卷，不能重复作答');
    if (!isManager) {
      const now = Math.floor(Date.now() / 1000);
      const endAt = Number(exam.end_at ?? 0);
      // 结束时间给 2 分钟缓冲：学生卡在最后几秒交卷不该被判无效
      if (endAt > 0 && now > endAt + 120) throw AppError.badRequest('考试已结束，不能再交卷');
    }

    const paper = this.paperOf(examId);
    if (paper.length === 0) throw AppError.badRequest('本场考试还没有组卷');

    // 判分口径全部在 exam-grade（纯函数），这里只负责取卷面、算用时与落库
    const graded = gradeSubmission({
      paper,
      answers,
      totalScore: Number(exam.total_score ?? 100),
      passScore: exam.pass_score,
    });
    const started = startedAt !== undefined && startedAt > 0 ? startedAt : Date.now();
    const usedSeconds = Math.min(
      exam.duration_minutes * 60 + 30,
      Math.max(0, Math.floor((Date.now() - started) / 1000)),
    );
    /**
     * 存库只留判分必需的四元组：题干/选项/解析在成绩页按卷面重建。
     * 否则一份 1000 题的卷要写 3~4MB JSON，几十人同时交卷就把写入排队成秒级。
     */
    const attemptId = this.exams.createAttempt({
      examId,
      userId: viewer.id,
      answers: slimResults(graded.results),
      score: graded.score,
      total: graded.total,
      passed: graded.passed,
      usedSeconds,
    });
    this.audit.writeBuffered({
      actorId: viewer.id,
      actorName: viewer.username,
      action: 'exam.submit',
      targetType: 'exam',
      targetId: examId,
      detail: { score: graded.score, total: graded.total, passed: graded.passed },
    });
    return {
      attemptId,
      score: graded.score,
      total: graded.total,
      passed: graded.passed,
      need: graded.need,
      usedSeconds,
      manual: graded.manual,
    };
  }

  /** 可打印试卷 HTML（A4/A3、横竖版、双栏、含答案、答题卡、密封线） */
  paperHtml(examId: number, overrides?: Partial<PaperRenderOptions>): string {
    const exam = this.findById(examId);
    return buildPaperHtml(exam, this.exams.listQuestions(examId), overrides);
  }

  /** 我的成绩（含逐题结果，便于复盘） */
  myResult(viewer: User, examId: number): MyResult {
    const exam = this.findById(examId);
    const attempt = this.exams.findAttempt(examId, viewer.id);
    if (!attempt) throw AppError.notFound('暂无成绩');
    return buildMyResult(exam, attempt, this.paperOf(examId), viewer);
  }

  /** 成绩单：全部学生作答 + 统计（管理端） */
  scoreSheet(examId: number): ScoreSheet {
    const exam = this.findById(examId);
    return buildScoreSheet(exam, this.exams.attemptsOf(examId));
  }

  /** 成绩单 CSV */
  scoreSheetCsv(examId: number): { filename: string; rows: unknown[][] } {
    return buildScoreSheetCsv(this.scoreSheet(examId));
  }

  /** 我的全部考试成绩 */
  myExams(viewer: User): {
    exam_id: number;
    exam_title: string;
    course_id: number;
    course_name: string;
    score: number;
    total: number;
    passed: 0 | 1;
    used_seconds: number;
    created_at: number;
  }[] {
    return this.exams.attemptsByUser(viewer.id).map((a) => ({
      exam_id: a.exam_id,
      exam_title: a.exam_title,
      course_id: a.course_id,
      course_name: a.course_name,
      score: a.score,
      total: a.total,
      passed: a.passed,
      used_seconds: a.used_seconds,
      created_at: a.created_at,
    }));
  }

  private prepare(input: ExamDto): {
    courseId: number;
    title: string;
    description: string;
    durationMinutes: number;
    passScore: number;
    status: Exam['status'];
    /** 考试设置（对标学习通）：只在显式传入时覆盖，未传的项保持原值 */
    startAt?: number;
    endAt?: number;
    attemptLimit?: number;
    shuffleQuestions?: boolean;
    showAnswers?: boolean;
  } {
    const courseId = Number(input.courseId);
    if (!Number.isInteger(courseId) || !this.courses.findById(courseId)) throw AppError.badRequest('课程不存在');
    const title = String(input.title ?? '').trim();
    if (!title) throw AppError.badRequest('考试标题不能为空');
    const rawDuration = Number(input.durationMinutes);
    const durationMinutes = Number.isFinite(rawDuration) && rawDuration >= 1 ? Math.floor(rawDuration) : 60;
    const rawPass = Number(input.passScore);
    const passScore = Number.isFinite(rawPass) && rawPass >= 0 && rawPass <= 100 ? Math.round(rawPass) : 60;
    /** 时间戳：只接受非负整数（0 = 不限） */
    const stamp = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const startAt = stamp(input.startAt);
    const endAt = stamp(input.endAt);
    if (startAt !== undefined && endAt !== undefined && startAt > 0 && endAt > 0 && endAt <= startAt) {
      throw AppError.badRequest('结束时间必须晚于开始时间');
    }
    const limit =
      input.attemptLimit === undefined
        ? undefined
        : Math.min(99, Math.max(0, Math.floor(Number(input.attemptLimit) || 0)));
    return {
      courseId,
      title,
      description: String(input.description ?? ''),
      durationMinutes,
      passScore,
      status: input.status === 'published' ? 'published' : 'draft',
      ...(startAt === undefined ? {} : { startAt }),
      ...(endAt === undefined ? {} : { endAt }),
      ...(limit === undefined ? {} : { attemptLimit: limit }),
      ...(input.shuffleQuestions === undefined ? {} : { shuffleQuestions: input.shuffleQuestions === true }),
      ...(input.showAnswers === undefined ? {} : { showAnswers: input.showAnswers !== false }),
    };
  }
}
