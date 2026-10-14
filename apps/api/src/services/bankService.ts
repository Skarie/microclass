/**
 * 题库服务：题库/题目 CRUD、CSV 导入导出与模板、题目配图。
 * 答案编码与 CSV 语义与 V1 完全一致（domain/question.ts）。
 */
import fs from 'node:fs';
import { AppError, type Question, type QuestionType, type User } from '@microclass/shared';
import type { BankKind, BankListFilter, BankRepository, BankWithStats } from '../db/repositories/bankRepository.js';
import { normalizeBookKey } from '../db/repositories/bankRepository.js';
import type { QuestionFilter, QuestionInput, QuestionRepository } from '../db/repositories/questionRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { StorageService } from './storageService.js';
import type { ExamService } from './examService.js';
import type { DifficultyService } from './difficultyService.js';
import { inferStage, levelFromScore, scoreDifficulty } from '../domain/difficulty.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import { parseCsv, toCsv } from '../utils/csv.js';
import { inlineImagesToDocx } from '../utils/questionDocxImages.js';
import {
  DEFAULT_COLUMN_MAP,
  TYPE_LABEL,
  answerToCsv,
  buildColumnMap,
  csvRowToQuestion,
  fillBlankCount,
  hasMediaOnlyAnalysis,
  hasQuestionImage,
  normalizeAnswer,
  parseOptions,
  questionFingerprint,
  type CsvQuestionRow,
} from '../domain/question.js';
import { parseQuestionText, questionsToMarkdown } from '../domain/questionText.js';
import {
  buildDocx,
  imageExtension,
  imageSize,
  readDocx,
  readImageFile,
  type DocxBlock,
  type DocxContent,
  type DocxImage,
  type DocxImageFile,
} from '../utils/docx.js';

/** 单次导入最多带进来多少张 Word 配图（防止一个巨大的 docx 把磁盘写满） */
const MAX_IMPORTED_IMAGES = 200;

export interface BankDto {
  name: string;
  lessonId?: number | null;
  /** 标准化元数据（题库类型/学科/书册）：新建题目会继承，难度模型据此判断学段 */
  kind?: string;
  subject?: string;
  book?: string;
  /** 归属课程（手工把「未归属」的题库挂到某门课）；`null` = 移出课程 */
  courseId?: number | null;
}

export interface QuestionDto {
  bankId: number;
  lessonId?: number | null;
  type: QuestionType;
  stem: string;
  /** 选项文本；单/多选题以字母串（如 "ACD"）或下标串（"0,2"）提交答案 */
  options?: string[];
  answer?: string;
  analysis?: string;
  sort?: number;
  /** 直接指定已上传图片的相对路径（一般走独立的图片上传接口） */
  imagePath?: string;
  /** 难度：easy / medium / hard（留空 = 交给难度模型自动判定） */
  difficulty?: string;
  /**
   * 允许缺答案：仅"资料批量导入"使用（答案册扫描不清/缺失时，整题不该丢）。
   * 界面单题创建不传，仍强制填答案。
   */
  allowMissingAnswer?: boolean;
  /** 标准化元数据：不传则**继承题库**的学科/书册（难度模型的学段基准靠它） */
  subject?: string;
  stage?: string;
  book?: string;
  chapter?: string;
  point?: string;
}

/** 面向学生/考试的题面：剥掉答案与解析 */
export interface QuestionForViewer {
  id: number;
  bank_id: number;
  lesson_id: number | null;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string[];
  sort: number;
  /** 难度：easy / medium / hard（空串 = 未标注） */
  difficulty: string;
  /** 难度模型（迁移 0016）：0–100 综合分与五级星级（1 最易 … 5 最难） */
  difficulty_score: number;
  difficulty_level: number;
  /** 难度来源：auto / calibrated / manual（空串 = 还没算过） */
  difficulty_source: string;
  /** 参与校准的作答样本数与经验正确率 */
  difficulty_n: number;
  difficulty_p: number | null;
  /** 填空题空位数（>1 时提示学生按顺序用「；」分隔；其他题型为 0） */
  blanks: number;
  /** 标准化元数据（迁移 0008；历史数据为空串） */
  subject: string;
  stage: string;
  book: string;
  chapter: string;
  point: string;
  source_path: string;
  source_no: string;
  answer?: string;
  analysis?: string;
}

const REQUIRES_ANSWER: QuestionType[] = ['single', 'multiple', 'judge'];

/** 题库体检结果（缓存与接口共用） */
export interface BankHealthResult {
  scope: { bankId: number | null; name: string };
  stats: ReturnType<QuestionRepository['health']>;
  metadata: { withSubject: number; withBook: number; withPoint: number; withHash: number };
  duplicates: { content_hash: string; n: number; answers: number; stem: string }[];
  kinds: { kind: string; banks: number; questions: number }[];
  /** 难度结构与来源（迁移 0016 的难度模型） */
  difficulty: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    histogram: { bucket: number; questions: number }[];
  };
  cachedAt: number;
}

/** 体检结果缓存时长：大库聚合要几秒，5 分钟内复用足够"实时" */
const HEALTH_CACHE_MS = 5 * 60 * 1000;

export class BankService {
  /** 体检结果缓存（key: bankId|limit） */
  private readonly healthCache = new Map<string, { at: number; value: Omit<BankHealthResult, 'cachedAt'> }>();

  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly lessons: LessonRepository,
    private readonly audit: AuditRepository,
    private readonly storage: StorageService,
    /** 题库导入的题图（内容寻址）：导出 Word 时把题面里的内联图片也嵌进去 */
    private readonly media: QuestionMediaStore,
    /** 难度模型（体检里报难度结构与来源；手动改难度时算一个参考分） */
    private readonly difficulty: DifficultyService,
  ) {}

  // ---------------- 题库 ----------------

  list(options?: BankListFilter): BankWithStats[] {
    return this.banks.list(options);
  }

  /** 当前筛选条件下的题库总数（配合分页） */
  countBanks(options?: BankListFilter): number {
    return this.banks.count(options);
  }

  /**
   * 筛选树第一层：课程列表。
   *
   * 原来题库只能按「课时 / 类型 / 书册」平铺筛，7,000+ 个章节题库与整卷试卷
   * 因为不挂课时而根本筛不出来；现在统一按「课程 → 章节 → 小节 → 题库」组织。
   */
  catalog(): {
    courses: ReturnType<BankRepository['catalogCourses']>;
    unbound: { bankCount: number; questionCount: number };
    /** 未归属课程按册次分组（复习类/未建课程的册次仍能分类导航） */
    unboundBooks: ReturnType<BankRepository['catalogUnboundBooks']>;
    binding: { bound: number; unbound: number; banks: number };
  } {
    return {
      courses: this.banks.catalogCourses(),
      unbound: this.banks.catalogUnbound(),
      unboundBooks: this.banks.catalogUnboundBooks(),
      binding: this.banks.courseBindingStats()[0] ?? { bound: 0, unbound: 0, banks: 0 },
    };
  }

  /**
   * 把某个**册次**下所有未归属题库挂到指定课程（courseId 为 null 表示移出课程）。
   * 界面「未归属课程 → 按册次」里的批量操作走这里，避免 1700+ 个题库一个个点。
   */
  bindUnboundByBook(
    actor: User,
    book: string,
    courseId: number | null,
  ): { updated: number; book: string; courseId: number | null; courseName: string } {
    const name = book.trim();
    if (!name) throw AppError.badRequest('册次不能为空');
    let courseName = '';
    if (courseId !== null) {
      // 用仓储已有的课程目录查询做存在性校验（不存在会抛 notFound），顺便拿课程名
      const course = this.banks.catalogCourse(courseId).course;
      if (!course) throw AppError.notFound('课程不存在');
      courseName = course.name;
    }
    const updated = this.banks.bindUnboundByBook(name, courseId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.bindByBook',
      targetType: 'course',
      targetId: courseId ?? 0,
      detail: { book: name, updated, courseId },
    });
    return { updated, book: name, courseId, courseName };
  }

  /** 某门课的章节 → 小节 → 题库 目录 */
  catalogCourse(courseId: number): ReturnType<BankRepository['catalogCourse']> {
    const res = this.banks.catalogCourse(courseId);
    if (!res.course) throw AppError.notFound('课程不存在');
    return res;
  }

  /**
   * 一键回填「题库归属课程」：
   *   1) 课时配套题库按 lesson → course 直接归属；
   *   2) 章节题库 / 整卷试卷按册次匹配（课程名 `·` 之后的册次 vs `banks.book`，取最长匹配）；
   *   3) 匹配不上的留在「未归属课程」，界面里可手工挂。
   */
  rebindCourses(actor: User): {
    byLesson: number;
    byBook: number;
    unmatched: number;
    unmatchedBooks: { book: string; banks: number }[];
    binding: { bound: number; unbound: number; banks: number };
  } {
    const byLesson = this.banks.bindCourseByLesson();
    const courses = this.banks.courseBookKeys().filter((c) => c.key !== '');
    const unbound = this.banks.unboundWithBook();
    const updates: { bankId: number; courseId: number }[] = [];
    for (const bank of unbound) {
      const book = normalizeBookKey(bank.book);
      if (!book) continue;
      let best: { id: number; key: string } | undefined;
      for (const course of courses) {
        const key = normalizeBookKey(course.key);
        if (!key) continue;
        const hit =
          book === key || book.startsWith(key) || key.endsWith(book) || (book.length >= 3 && key.includes(book));
        if (!hit) continue;
        if (!best || key.length > best.key.length) best = { id: course.id, key };
      }
      if (best) updates.push({ bankId: bank.id, courseId: best.id });
    }
    const byBook = this.banks.setCourseBindings(updates);
    const stillUnbound = this.banks.unboundWithBook();
    const grouped = new Map<string, number>();
    for (const bank of stillUnbound) {
      const key = String(bank.book ?? '').trim() || '(无册次信息)';
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    const unmatchedBooks = [...grouped.entries()]
      .map(([book, banks]) => ({ book, banks }))
      .sort((a, b) => b.banks - a.banks);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.rebind_courses',
      targetType: 'bank',
      detail: { byLesson, byBook, unmatched: stillUnbound.length },
    });
    return {
      byLesson,
      byBook,
      unmatched: stillUnbound.length,
      unmatchedBooks: unmatchedBooks.slice(0, 20),
      binding: this.banks.courseBindingStats()[0] ?? { bound: 0, unbound: 0, banks: 0 },
    };
  }

  /**
   * 整卷试卷题库 → 一键建考试（多样化：导入进来的期中/期末/单元测试卷可以直接变成一场考试）。
   * 返回考试 id 与加入的题目数；试卷为空时拒绝（避免建出空考试）。
   */
  createExamFromBank(
    actor: User,
    bankId: number,
    input: { courseId: number; title?: string; durationMinutes?: number; passScore?: number; publish?: boolean },
    examService: ExamService,
  ): { examId: number; questions: number } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows = this.questions.listByBank(bankId);
    if (rows.length === 0) throw AppError.badRequest('这个题库还没有题目，无法建考试');
    if (!Number.isInteger(input.courseId) || input.courseId <= 0) {
      throw AppError.badRequest('请选择要挂到哪门课程（考试必须属于一门课程）');
    }
    const title = (input.title ?? bank.name).trim().slice(0, 100) || bank.name;
    // 课程是否存在由 ExamService.prepare 校验（它持有课程仓储），这里不重复实现
    const examId = examService.create(actor, {
      courseId: input.courseId,
      title,
      description: `由题库「${bank.name}」一键生成（共 ${rows.length} 题）`,
      ...(input.durationMinutes ? { durationMinutes: Math.max(1, Math.floor(input.durationMinutes)) } : {}),
      ...(input.passScore ? { passScore: Math.max(0, Math.floor(input.passScore)) } : {}),
      status: input.publish === false ? 'draft' : 'published',
    });
    const added = examService.addQuestions(
      actor,
      examId,
      rows.map((q) => q.id),
    );
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.create_exam',
      targetType: 'exam',
      targetId: examId,
      detail: { bankId, questions: added },
    });
    return { examId, questions: added };
  }

  /**
   * 题库内去重（标准化）：同一题库里「题干 + 选项」指纹相同、**答案也一致**的题只保留一条。
   * `dryRun`（默认 true）只报告不删；答案冲突的组不动，由体检单独列出。
   */
  dedupeBank(
    actor: User,
    bankId: number,
    options?: { dryRun?: boolean },
  ): {
    dryRun: boolean;
    groups: number;
    removable: number;
    removed: number;
    samples: { stem: string; count: number }[];
  } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const groups = this.questions.duplicateIdsInBank(bankId);
    const removable = groups.reduce((s, g) => s + g.removeIds.length, 0);
    const samples = groups.slice(0, 10).map((g) => {
      const q = this.questions.findById(g.keepId);
      return { stem: String(q?.stem ?? '').slice(0, 120), count: g.removeIds.length + 1 };
    });
    if (options?.dryRun !== false || removable === 0) {
      return { dryRun: true, groups: groups.length, removable, removed: 0, samples };
    }
    const removed = this.questions.deleteMany(groups.flatMap((g) => g.removeIds));
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.dedupe',
      targetType: 'bank',
      targetId: bankId,
      detail: { groups: groups.length, removed },
    });
    return { dryRun: false, groups: groups.length, removable, removed, samples };
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

  // ---------------- 题库体检 ----------------
  /**
   * 题库体检（标准化与质量）。
   *
   * 全库体检要扫 36.6 万题（库约 590MB、常在 NAS 机械盘上），因此结果**缓存 5 分钟**：
   * 管理端反复打开/切换时秒回；`refresh: true` 强制重算。
   */
  health(bankId: number | undefined, limit: number, options?: { refresh?: boolean }): BankHealthResult {
    const cacheKey = `${bankId ?? 'all'}|${limit}`;
    const cached = this.healthCache.get(cacheKey);
    if (!options?.refresh && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
      return { ...cached.value, cachedAt: cached.at };
    }
    let name = '全库';
    if (bankId !== undefined) {
      const bank = this.banks.findById(bankId);
      if (!bank) throw AppError.notFound('题库不存在');
      name = bank.name;
    }
    /** 体检的核心统计（全表扫描集中在这里，尽量只算一次） */
    const stats = this.questions.health(bankId);
    const value = {
      scope: { bankId: bankId ?? null, name },
      stats,
      metadata: {
        // 总数已由 stats 算出，传下去避免每个字段再来一次全表 COUNT(*)
        withSubject: this.questions.countByMeta(bankId, 'subject', stats.total),
        withBook: this.questions.countByMeta(bankId, 'book', stats.total),
        withPoint: this.questions.countByMeta(bankId, 'point', stats.total),
        withHash: this.questions.countByMeta(bankId, 'content_hash', stats.total),
      },
      duplicates: this.questions.duplicateGroups(limit, bankId),
      kinds: this.banks.kindStats(),
      difficulty: this.difficulty.stats(bankId),
    };
    const at = Date.now();
    this.healthCache.set(cacheKey, { at, value });
    return { ...value, cachedAt: at };
  }

  detail(id: number): { bank: BankWithStats; questions: QuestionForViewer[] } {
    const bank = this.banks.findById(id);
    if (!bank) throw AppError.notFound('题库不存在');
    const [withStats] = this.banks.list().filter((b) => b.id === id);
    const rows = this.questions.listByBank(id);
    return {
      bank: withStats ?? { ...bank, lesson_title: this.banks.lessonTitle(bank.lesson_id), question_count: rows.length },
      // 教师视角保留答案与解析
      questions: rows.map((q) => toViewer(q, true)),
    };
  }

  create(actor: User, input: BankDto): number {
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('题库名称不能为空');
    const lessonId = this.resolveLesson(input.lessonId);
    /**
     * 课程归属规则（与 `update` 保持一致）：
     *   - 显式传了 `courseId`：以它为准（`null` = 不归属任何课程）；
     *   - 没传但挂了课时：跟着课时的课程走；
     *   - 都没有：不归属课程。
     *
     * 注意：`create` 以前**忽略**了 `courseId`，只从 lessonId 推导，
     * 于是「界面选了归属课程、但没挂课时」的题库 `course_id` 全是 NULL ——
     * 真机上 1339 个「未归属课程」题库与这个吻合，组卷题池也因此搜不到它们。
     */
    const explicitCourse =
      input.courseId === undefined ? undefined : input.courseId === null ? null : Number(input.courseId);
    const courseId =
      explicitCourse !== undefined
        ? explicitCourse
        : lessonId === null
          ? null
          : (this.lessons.findById(lessonId)?.course_id ?? null);
    const id = this.banks.create({
      name,
      lessonId,
      courseId,
      ...(input.kind ? { kind: input.kind as BankKind } : {}),
      ...(input.subject ? { subject: String(input.subject) } : {}),
      ...(input.book ? { book: String(input.book) } : {}),
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.create',
      targetType: 'bank',
      targetId: id,
      detail: { name, lessonId, courseId },
    });
    return id;
  }

  update(actor: User, id: number, input: BankDto): void {
    const bank = this.banks.findById(id);
    if (!bank) throw AppError.notFound('题库不存在');
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('题库名称不能为空');
    const lessonId = this.resolveLesson(input.lessonId);
    /**
     * 课程归属规则：
     *   - 显式传了 courseId：以它为准（`null` = 移出课程）；
     *   - 没传但改了课时：跟着课时的课程走；
     *   - 都没动：不动（`undefined` 让仓储层保持原值）。
     */
    const explicitCourse =
      input.courseId === undefined ? undefined : input.courseId === null ? null : Number(input.courseId);
    const derivedCourse =
      explicitCourse !== undefined
        ? explicitCourse
        : lessonId !== null && lessonId !== bank.lesson_id
          ? (this.lessons.findById(lessonId)?.course_id ?? null)
          : undefined;
    this.banks.update(id, {
      name,
      lessonId,
      ...(derivedCourse === undefined ? {} : { courseId: derivedCourse }),
      ...(input.subject === undefined ? {} : { subject: String(input.subject) }),
      ...(input.book === undefined ? {} : { book: String(input.book) }),
      ...(input.kind ? { kind: input.kind as BankKind } : {}),
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.update',
      targetType: 'bank',
      targetId: id,
    });
  }

  remove(actor: User, id: number): void {
    const bank = this.banks.findById(id);
    if (!bank) throw AppError.notFound('题库不存在');
    // 题目随题库级联删除（ON DELETE CASCADE）
    this.banks.delete(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.delete',
      targetType: 'bank',
      targetId: id,
      detail: { name: bank.name },
    });
  }

  // ---------------- 题目 ----------------

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
      ...(filter?.mediaOnlyAnalysis === true ? { mediaOnlyAnalysis: true } : {}),
    };
    const rows = this.questions.listByBank(bankId, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = this.questions.countByBank(bankId, where);
    return { total, page, pageSize, questions: rows.map((q) => toViewer(q, true)) };
  }

  findQuestion(id: number): Question | undefined {
    return this.questions.findById(id);
  }

  createQuestion(actor: User, input: QuestionDto): number {
    const prepared = this.prepareQuestion(input);
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
    const prepared = this.prepareQuestion({ ...input, imagePath: input.imagePath ?? existing.image_path });
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

  /**
   * 老师在界面上指定过难度 → 记为**人工标注**（`difficulty_source = 'manual'`），
   * 之后「重算难度」不会覆盖它（人工判断优先于模型先验）。
   * 同时按模型算一个参考分，方便按分数排序/分段统计。
   */
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

  /**
   * 批量设置难度（人工标注）。
   * 逐题走 `markManualDifficulty`：人工选的档位直接采用，分数取「模型分与档位区间中点」的均值，
   * 与单条编辑完全一致；之后「重算难度」不会覆盖这些题。
   */
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
      this.updateQuestion(actor, id, { ...rowToDto(existing), difficulty });
      updated += 1;
    }
    return { updated, skipped };
  }

  /** 题目配图：保存到 uploads/question-images 并绑定到题目 */
  /**
   * 批量导入题目（资料提炼结果）。逐题独立：某一题失败只记下原因，不影响其它题。
   * 带图的题走 `createImageQuestion`（题面是图，题干可为空）；纯文字题走 `createQuestion`。
   */
  importQuestions(
    actor: User,
    bankId: number,
    rawQuestions: unknown[],
    files: Map<string, { fileName: string; data: Buffer; mimeType: string }>,
    /**
     * 内联题图：key 为数字（对应 manifest 里的 `[[img:0]]`），value 为图片字节。
     * 服务端把它们存进题图仓库（内容寻址去重），再把占位符换成 markdown 图片。
     */
    mediaFiles: Map<number, { fileName: string; data: Buffer; mimeType: string }> = new Map(),
  ): { inserted: number; failed: { index: number; reason: string }[]; missingAnswer: number } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    let inserted = 0;
    const failed: { index: number; reason: string }[] = [];

    /**
     * 把 `[[img:N]]` 占位符换成题图 URL。一次性把整份资料的图放在同一个请求里带上，
     * 避免"一张图一个请求"把限流打满（真机 429 的根因）。
     */
    const mediaUrlCache = new Map<number, string>();
    const replaceMediaPlaceholders = (text: string): string =>
      text.replace(/\[\[img:(\d+)\]\]/g, (_m, n: string) => {
        const idx = Number(n);
        if (mediaUrlCache.has(idx)) return mediaUrlCache.get(idx) ?? '';
        const f = mediaFiles.get(idx);
        if (!f) {
          mediaUrlCache.set(idx, '');
          return '';
        }
        const saved = this.media.save(f.data);
        const url = saved ? `![](${saved.url})` : '';
        mediaUrlCache.set(idx, url);
        return url;
      });

    /** 只认基本类型：manifest 是外部数据，字段可能是对象/数组，直接 String() 会得到 '[object Object]' */
    const asText = (v: unknown): string =>
      typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

    rawQuestions.forEach((raw, index) => {
      const q = (raw ?? {}) as Record<string, unknown>;
      const type = (asText(q.type) || 'short') as QuestionType;
      const stem = replaceMediaPlaceholders(asText(q.stem)).trim();
      const options = Array.isArray(q.options)
        ? q.options.map((o) => replaceMediaPlaceholders(asText(o))).filter((s) => s !== '')
        : [];
      const answer = replaceMediaPlaceholders(asText(q.answer));
      const analysis = replaceMediaPlaceholders(asText(q.analysis));
      const meta = {
        ...(asText(q.chapter) ? { chapter: asText(q.chapter) } : {}),
        ...(asText(q.point) ? { point: asText(q.point) } : {}),
        ...(asText(q.difficulty) ? { difficulty: asText(q.difficulty) } : {}),
        ...(asText(q.subject) ? { subject: asText(q.subject) } : {}),
        ...(asText(q.book) ? { book: asText(q.book) } : {}),
      };
      const imageField = asText(q.image);
      const file = imageField === '' ? undefined : files.get(imageField);
      try {
        if (file) {
          this.createImageQuestion(actor, {
            bankId,
            type,
            ...(stem ? { stem } : {}),
            answer,
            analysis,
            ...meta,
            file,
          });
        } else {
          this.createQuestion(actor, {
            bankId,
            type,
            stem,
            ...(options.length > 0 ? { options } : {}),
            answer,
            analysis,
            // 批量导入允许缺答案（由调用方在 finally 里统计 missingAnswer）
            allowMissingAnswer: true,
            ...meta,
          });
        }
        inserted += 1;
      } catch (e) {
        failed.push({ index, reason: e instanceof Error ? e.message : '未知错误' });
      }
    });

    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.import_batch',
      targetType: 'bank',
      targetId: bankId,
      detail: { inserted, failed: failed.length },
    });
    /**
     * 缺答案的题数：答案册没覆盖/被水印遮挡时，题目**照样入库**（不整题丢弃），
     * 这里如实报出来，便于导入脚本与老师后续补答案。
     */
    const missingAnswer = rawQuestions.filter((q) => {
      const a = (q as { answer?: unknown })?.answer;
      return typeof a !== 'string' || a.trim() === '';
    }).length;
    return { inserted, failed, missingAnswer };
  }

  /**
   * 建**图片题**（扫描件拆题用）：题面是图片，题干文本可以为空。
   * 返回题目 id；图片落在 `question-images` 目录（与「上传配图」同一套存储）。
   */
  createImageQuestion(
    actor: User,
    input: {
      bankId: number;
      type: QuestionType;
      /** 题干文字（可有可无：有文字层/OCR 时填，纯图片题留空） */
      stem?: string;
      answer?: string;
      analysis?: string;
      difficulty?: string;
      lessonId?: number | null;
      subject?: string;
      stage?: string;
      book?: string;
      chapter?: string;
      point?: string;
      file: { fileName: string; data: Buffer; mimeType: string };
    },
  ): { id: number; imagePath: string } {
    const bank = this.banks.findById(input.bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    if (!['single', 'multiple', 'judge', 'fill', 'short'].includes(input.type)) {
      throw AppError.badRequest('题型非法');
    }
    const stem = String(input.stem ?? '').trim();
    // 选择题：选项内容在图片里，这里补字母位让学生能作答、判分照旧
    const options = input.type === 'single' || input.type === 'multiple' ? ['A', 'B', 'C', 'D'] : [];
    const id = this.questions.create({
      bankId: input.bankId,
      lessonId: input.lessonId ?? bank.lesson_id ?? null,
      type: input.type,
      stem,
      imagePath: '',
      options,
      answer: String(input.answer ?? ''),
      analysis: String(input.analysis ?? ''),
      difficulty: String(input.difficulty ?? ''),
      subject: String(input.subject ?? bank.subject ?? ''),
      stage: String(input.stage ?? ''),
      book: String(input.book ?? ''),
      chapter: String(input.chapter ?? ''),
      point: String(input.point ?? ''),
      // 图片题：题面就是图片，has_image 必须为真（否则"有图"筛选与统计会漏）
      hasImage: true,
      analysisMediaOnly: false,
    });
    const saved = this.storage.save({
      subdir: 'question-images',
      fileName: input.file.fileName || `scan-${id}.png`,
      data: input.file.data,
      mimeType: input.file.mimeType,
      imagesOnly: true,
    });
    this.questions.setImage(id, saved.relPath);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.create_image',
      targetType: 'question',
      targetId: id,
      detail: { bankId: input.bankId, type: input.type, fileName: input.file.fileName },
    });
    return { id, imagePath: saved.relPath };
  }

  attachImage(actor: User, id: number, file: { fileName: string; data: Buffer; mimeType: string }): string {
    const question = this.questions.findById(id);
    if (!question) throw AppError.notFound('题目不存在');
    const saved = this.storage.save({
      subdir: 'question-images',
      fileName: file.fileName,
      data: file.data,
      mimeType: file.mimeType,
      imagesOnly: true,
    });
    this.questions.setImage(id, saved.relPath);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'question.image',
      targetType: 'question',
      targetId: id,
      detail: { imagePath: saved.relPath },
    });
    return saved.relPath;
  }

  /** 题目配图绝对路径（越权/穿越防护由 StorageService 负责） */
  resolveImage(question: Question): string | null {
    if (!question.image_path) return null;
    const abs = this.storage.resolve(question.image_path);
    return abs && fs.existsSync(abs) ? abs : null;
  }

  /**
   * 把题面里的内联题图（`![](/api/v1/question-media/<sha1>.<ext>)`）换成 docx 的 `[[img:N]]` 标记：
   * 题库导入的图片是内容寻址的，不在 uploads/question-images 下，旧路径取不到，导出 Word 时按这个走。
   */
  /** 内联题图 → docx 图片标记（逻辑与试卷 Word 导出共用 utils/questionDocxImages） */
  private inlineImagesToDocx(text: string, images: DocxImage[]): string {
    return inlineImagesToDocx(text, images, (file) => this.media.resolve(file));
  }

  // ---------------- CSV ----------------

  /** 导出题库为 CSV（列序与 V1 模板一致） */
  exportCsv(bankId: number): { filename: string; body: string } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows: unknown[][] = [['题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '答案', '解析']];
    for (const q of this.questions.listByBank(bankId)) {
      const options = parseOptions(q.options);
      const cells: unknown[] = [TYPE_LABEL[q.type], q.stem];
      for (let i = 0; i < 6; i += 1) cells.push(options[i] ?? '');
      cells.push(answerToCsv(q), q.analysis);
      rows.push(cells);
    }
    return { filename: `${bank.name}_题库.csv`, body: toCsv(rows) };
  }

  // ---------------- Markdown ----------------

  /**
   * 导出 Markdown：人可读、可进版本库、可直接贴进笔记软件或交给 AI 改写；
   * 用同一套纯文本规则，导出的文件可以再次导入（往返无损）。
   */
  exportMarkdown(bankId: number, options?: { withAnswers?: boolean }): { filename: string; body: string } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const questions = this.questions.listByBank(bankId);
    return {
      filename: `${bank.name}_题库.md`,
      body: questionsToMarkdown({
        title: bank.name,
        questions,
        ...(options?.withAnswers === undefined ? {} : { withAnswers: options.withAnswers }),
      }),
    };
  }

  /** Markdown 导入模板（含五种题型示例与写法说明） */
  templateMarkdown(): { filename: string; body: string } {
    return {
      filename: '题目导入模板.md',
      body: [
        '# 题目导入模板（Markdown / Word 通用）',
        '',
        '> 每道题：**题型行** → 题干 → 选项（可选）→ `答案：` → `解析：`（可选）。',
        '> 题型行支持 `## 单选题`、`**多选题**`、`[判断题]`、`第 1 题 · 单选` 等写法；',
        '> 也可以把题型写在题干开头，如 `【判断题】Java 是编译型语言。`',
        '> 选项支持 `A. x` / `A、x` / `A)x` / `（A）x`；判断题、填空题、简答题不需要选项。',
        '',
        '### 1. 单选题',
        '',
        'Java 中定义常量的关键字是？',
        '',
        'A. const',
        'B. final',
        'C. static',
        'D. define',
        '',
        '答案：B',
        '解析：final 修饰的变量为常量，不能再被赋值。',
        '',
        '---',
        '',
        '### 2. 多选题',
        '',
        '属于 Java 基本数据类型的有？',
        '',
        'A. int',
        'B. String',
        'C. boolean',
        'D. double',
        '',
        '答案：ACD',
        '解析：String 是引用类型。',
        '',
        '---',
        '',
        '### 3. 判断题',
        '',
        'Java 是纯面向对象语言。',
        '',
        '答案：错',
        '',
        '---',
        '',
        '### 4. 填空题',
        '',
        'Java 程序的入口方法是 ___ 。',
        '',
        '答案：main|Main',
        '解析：多个可接受答案用 | 分隔。',
        '',
        '---',
        '',
        '### 5. 简答题',
        '',
        '简述面向对象的三大特性。',
        '',
        '答案：封装、继承、多态',
        '',
      ].join('\n'),
    };
  }

  // ---------------- Word（.docx） ----------------

  /**
   * 导出 Word：一份可以直接打印、发给学生或教研组继续改的试卷。
   * 题目配图会**内嵌**进 docx（单文件即可分发）。
   */
  exportDocx(bankId: number, options?: { withAnswers?: boolean }): { filename: string; body: Buffer } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const withAnswers = options?.withAnswers !== false;
    const questions = this.questions.listByBank(bankId);

    const blocks: DocxBlock[] = [
      { type: 'title', text: bank.name },
      { type: 'subtitle', text: `共 ${questions.length} 题 · 由微课堂导出${withAnswers ? '' : '（不含答案解析）'}` },
    ];
    const images: DocxImage[] = [];

    questions.forEach((q, i) => {
      const optionTexts = parseOptions(q.options);
      blocks.push({ type: 'heading', text: `${i + 1}. ${TYPE_LABEL[q.type]}` });
      // 题面里的内联题图先转成 docx 图片标记（题库导入的题图片就在题干/选项/解析里）
      const stemText = this.inlineImagesToDocx(q.stem, images);
      blocks.push({ type: 'text', text: stemText });

      // 旧版「题目配图」：题干里没有内联图片时才单独嵌一张，避免重复
      const abs = stemText.includes('[[img:') ? null : this.resolveImage(q);
      if (abs) {
        const data = readImageFile(abs);
        if (data) {
          const size = imageSize(data) ?? { width: 480, height: 270 };
          const scale = size.width > 480 ? 480 / size.width : 1;
          const ext = imageExtension(data, abs);
          images.push({
            name: `image${images.length + 1}.${ext}`,
            data,
            widthPx: Math.round(size.width * scale),
            heightPx: Math.round(size.height * scale),
          });
          blocks.push({ type: 'text', text: `[[img:${images.length}]]` });
        }
      }

      optionTexts.forEach((opt, oi) => {
        blocks.push({
          type: 'option',
          text: `${String.fromCharCode(65 + oi)}. ${this.inlineImagesToDocx(opt, images)}`,
        });
      });
      if (withAnswers) {
        blocks.push({ type: 'answer', text: `答案：${answerToCsv(q)}` });
        if (q.analysis) {
          blocks.push({ type: 'analysis', text: `解析：${this.inlineImagesToDocx(q.analysis, images)}` });
        }
      }
      blocks.push({ type: 'divider', text: '' });
    });

    return { filename: `${bank.name}_试卷.docx`, body: buildDocx({ title: bank.name, blocks, images }) };
  }

  // ---------------- 导入（CSV / Markdown / txt / Word） ----------------

  /**
   * 按文件类型导入题目：
   *   - `.csv` → 逐行解析（Excel 习惯）
   *   - `.md` / `.txt` / 其它纯文本 → 纯文本题块解析
   *   - `.docx` → 抽出 Word 正文文本后，走**同一套**纯文本题块解析
   * 逐题校验：失败的题带序号与原因返回，不影响其它题。
   */
  importFile(
    actor: User,
    bankId: number,
    file: { filename: string; data: Buffer },
  ): { inserted: number; errors: string[]; warnings: string[] } {
    const name = file.filename.toLowerCase();
    if (name.endsWith('.docx')) {
      let content: DocxContent;
      try {
        content = readDocx(file.data);
      } catch (e) {
        throw AppError.badRequest(`无法读取 Word 文件：${e instanceof Error ? e.message : '格式不受支持'}`);
      }
      // 图片位置以 `[[img:N]]` 标记留在文本里，解析后按题把配图存进题目图片目录
      return this.importText(actor, bankId, content.paragraphs.join('\n'), 'docx', content.images);
    }
    const text = file.data.toString('utf8');
    if (name.endsWith('.csv')) {
      const res = this.importCsv(actor, bankId, text);
      return { ...res, warnings: [] };
    }
    return this.importText(actor, bankId, text, 'md');
  }

  /** 导入 Markdown / 纯文本题块（Word 时带内嵌图片） */
  importText(
    actor: User,
    bankId: number,
    text: string,
    source: 'md' | 'docx' = 'md',
    images: DocxImageFile[] = [],
  ): { inserted: number; errors: string[]; warnings: string[] } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const parsed = parseQuestionText(text);
    if (parsed.questions.length === 0 && parsed.errors.length === 0) {
      throw AppError.badRequest('没有解析到题目：请确认每道题都有题型与「答案：」行');
    }
    const { inserted, warnings: imageWarnings } = this.insertDrafts(bankId, bank.lesson_id, parsed.questions, images);
    const warnings = [...parsed.warnings, ...imageWarnings];
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.import_text',
      targetType: 'bank',
      targetId: bankId,
      detail: {
        source,
        inserted,
        failed: parsed.errors.length,
        warnings: warnings.length,
        images: images.length,
      },
    });
    return { inserted, errors: parsed.errors, warnings };
  }

  /** 导入 CSV：逐行校验，失败行返回行号与原因，不阻断其它行 */
  importCsv(actor: User, bankId: number, text: string): { inserted: number; errors: string[] } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const rows = parseCsv(text);
    if (rows.length === 0) throw AppError.badRequest('CSV 内容为空');

    let map = DEFAULT_COLUMN_MAP;
    let start = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (/题型|题干|选项A/.test((rows[i] ?? []).join(','))) {
        map = buildColumnMap(rows[i] ?? []);
        start = i + 1;
        break;
      }
    }

    const pending: CsvQuestionRow[] = [];
    const errors: string[] = [];
    for (let i = start; i < rows.length; i += 1) {
      const parsed = csvRowToQuestion(rows[i] ?? [], map);
      if (!parsed.ok) {
        errors.push(`第 ${i + 1} 行: ${parsed.error}`);
        continue;
      }
      pending.push(parsed.question);
    }

    const { inserted } = this.insertDrafts(bankId, bank.lesson_id, pending);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.import_csv',
      targetType: 'bank',
      targetId: bankId,
      detail: { inserted, failed: errors.length },
    });
    return { inserted, errors };
  }

  /**
   * 批量入库（导入的各格式共用）。
   * `imageIndex` 指向 docx 内嵌图片（1 开始）：存进题目图片目录并写回 `image_path`；
   * 单张图片不合法（格式不在白名单等）时只记 warning，题目照常导入。
   */
  private insertDrafts(
    bankId: number,
    lessonId: number | null,
    drafts: CsvQuestionRow[],
    images: DocxImageFile[] = [],
  ): { inserted: number; warnings: string[] } {
    const warnings: string[] = [];
    let savedImages = 0;

    const pending: QuestionInput[] = drafts.map((q) => {
      let imagePath: string | undefined;
      if (q.imageIndex !== undefined) {
        const img = images[q.imageIndex - 1];
        if (!img) {
          warnings.push(`有 1 道题的 Word 配图在文件里找不到（第 ${q.imageIndex} 张），已跳过图片`);
        } else if (savedImages >= MAX_IMPORTED_IMAGES) {
          warnings.push(`Word 里的配图超过 ${MAX_IMPORTED_IMAGES} 张，超出的已跳过`);
        } else {
          try {
            const ext = imageExtension(img.data, img.name);
            const saved = this.storage.save({
              subdir: 'question-images',
              fileName: `word-${Date.now().toString(36)}-${savedImages + 1}.${ext}`,
              data: img.data,
              mimeType: `image/${ext}`,
              imagesOnly: true,
            });
            imagePath = saved.relPath;
            savedImages += 1;
          } catch {
            warnings.push('有 1 道题的 Word 配图格式不受支持（仅支持 png/jpg/gif/webp/bmp），已跳过');
          }
        }
      }
      return {
        bankId,
        lessonId,
        type: q.type,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        // 与手工新增走同一套标准化元数据口径
        contentHash: questionFingerprint(q.stem, q.options),
        hasImage: hasQuestionImage(q.stem, q.options, q.analysis),
        analysisMediaOnly: hasMediaOnlyAnalysis(q.analysis),
        ...(imagePath === undefined ? {} : { imagePath }),
      };
    });

    return { inserted: this.questions.insertMany(pending), warnings };
  }

  /** 导入模板（含各类题型示例） */
  templateCsv(): { filename: string; body: string } {
    return {
      filename: '题目导入模板.csv',
      body: toCsv([
        ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '答案', '解析'],
        [
          '单选题',
          'Java中定义常量的关键字是？',
          'const',
          'final',
          'static',
          'define',
          '',
          '',
          'B',
          'final 修饰的变量为常量',
        ],
        [
          '多选题',
          '属于Java基本数据类型的有？',
          'int',
          'String',
          'boolean',
          'double',
          '',
          '',
          'ACD',
          'String 是引用类型',
        ],
        ['判断题', 'Java是纯面向对象语言。', '', '', '', '', '', '', '对', ''],
        ['填空题', 'Java程序入口方法是 main 方法。', '', '', '', '', '', '', 'public static void', ''],
        ['简答题', '简述面向对象三大特性。', '', '', '', '', '', '', '封装、继承、多态', ''],
      ]),
    };
  }

  // ---------------- 内部 ----------------

  private resolveLesson(lessonId: number | null | undefined): number | null {
    if (lessonId === undefined || lessonId === null) return null;
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.badRequest('关联的课时不存在');
    return lessonId;
  }

  /** 校验并规范化题目输入 */
  private prepareQuestion(input: QuestionDto): QuestionInput {
    const bankId = Number(input.bankId);
    const bank = Number.isInteger(bankId) ? this.banks.findById(bankId) : undefined;
    if (!bank) throw AppError.notFound('题库不存在');

    const type = input.type;
    if (!['single', 'multiple', 'judge', 'fill', 'short'].includes(type)) throw AppError.badRequest('题型非法');

    const stem = String(input.stem ?? '').trim();
    if (!stem) throw AppError.badRequest('题干不能为空');

    let options: string[] = [];
    if (type === 'single' || type === 'multiple') {
      options = (Array.isArray(input.options) ? input.options : []).map((s) => String(s).trim()).filter(Boolean);
      if (options.length < 2) throw AppError.badRequest('选择题至少需要 2 个选项');
    }

    const rawAnswer = String(input.answer ?? '');
    // 单选/多选的答案允许两种写法：字母串（ACD）或下标串（0,2）
    const asIndexes = /^[A-Fa-f]+$/.test(rawAnswer.trim())
      ? rawAnswer
          .trim()
          .toUpperCase()
          .split('')
          .map((ch) => ch.charCodeAt(0) - 65)
          .join(',')
      : rawAnswer;
    const answer = normalizeAnswer(type, type === 'judge' ? rawAnswer : asIndexes, options);
    /** 批量导入允许缺答案（答案册扫描不清的资料）；单题创建仍然强制 */
    const allowMissingAnswer = input.allowMissingAnswer === true;
    if (!allowMissingAnswer && REQUIRES_ANSWER.includes(type) && answer === '')
      throw AppError.badRequest('请设置正确答案');

    const lessonId = this.resolveLesson(input.lessonId ?? null);
    // 配图必须是 uploads 目录下真实存在的文件（路径穿越由 StorageService 拦截）
    let imagePath = '';
    if (input.imagePath !== undefined && input.imagePath !== null) {
      const raw = String(input.imagePath).trim();
      if (raw !== '' && !this.storage.exists(raw)) throw AppError.badRequest('配图文件不存在，请重新上传');
      imagePath = raw;
    }

    const difficulty = String(input.difficulty ?? '')
      .trim()
      .toLowerCase();
    if (difficulty !== '' && !['easy', 'medium', 'hard'].includes(difficulty)) {
      throw AppError.badRequest('难度只能是 easy / medium / hard');
    }

    return {
      bankId,
      lessonId,
      type,
      stem,
      options,
      answer,
      analysis: String(input.analysis ?? ''),
      sort: Number.isInteger(input.sort) ? Number(input.sort) : 0,
      imagePath,
      difficulty,
      // 标准化元数据：题目没带学科/书册时**继承题库的**（题库是导入时按册次建的），
      // 难度模型的学段基准就靠它——否则手工新建的题会全部落在默认中档。
      subject: String(input.subject ?? '').trim() || String(bank.subject ?? ''),
      stage: String(input.stage ?? '').trim() || inferStage(String(bank.book ?? '')),
      book: String(input.book ?? '').trim() || String(bank.book ?? ''),
      chapter: String(input.chapter ?? '').trim(),
      point: String(input.point ?? '').trim(),
      // 标准化元数据在写入时就补齐：指纹用于查重与「同题不同答案」体检，
      // has_image 让体检不必对题干/选项做 LIKE 全表扫描（详见 docs/bank-standardization.md）
      contentHash: questionFingerprint(stem, options),
      hasImage: hasQuestionImage(stem, options, String(input.analysis ?? '')),
      // 解析「只有图片、没有一个字」也预先算好：真机 1.95 万道题是这样，
      // 体检给数量、题库里能筛出来（否则要靠关键字搜解析，搜不到任何东西）
      analysisMediaOnly: hasMediaOnlyAnalysis(String(input.analysis ?? '')),
    };
  }
}

/** 行数据 → 视图对象：学生视角不返回答案与解析 */
/** 数据行 → 写入用 DTO：批量操作只改一个字段，其余字段要原样带回校验流程 */
function rowToDto(q: Question): QuestionDto {
  return {
    bankId: q.bank_id,
    lessonId: q.lesson_id,
    type: q.type,
    stem: q.stem,
    options: parseOptions(q.options),
    answer: q.answer,
    analysis: q.analysis ?? '',
    imagePath: q.image_path ?? '',
    sort: q.sort,
    difficulty: q.difficulty ?? '',
    subject: q.subject ?? '',
    stage: q.stage ?? '',
    book: q.book ?? '',
    chapter: q.chapter ?? '',
    point: q.point ?? '',
  };
}

export function toViewer(q: Question, withAnswer: boolean): QuestionForViewer {
  const base: QuestionForViewer = {
    id: q.id,
    bank_id: q.bank_id,
    lesson_id: q.lesson_id,
    type: q.type,
    stem: q.stem,
    image_path: q.image_path,
    options: parseOptions(q.options),
    sort: q.sort,
    difficulty: q.difficulty ?? '',
    difficulty_score: Number.isFinite(Number(q.difficulty_score)) ? Number(q.difficulty_score) : -1,
    difficulty_level: levelFromScore(Number.isFinite(Number(q.difficulty_score)) ? Number(q.difficulty_score) : 50),
    difficulty_source: q.difficulty_source ?? '',
    difficulty_n: Number(q.difficulty_n ?? 0),
    difficulty_p: q.difficulty_p === null || q.difficulty_p === undefined ? null : Number(q.difficulty_p),
    blanks: fillBlankCount(q.type, q.answer),
    subject: q.subject ?? '',
    stage: q.stage ?? '',
    book: q.book ?? '',
    chapter: q.chapter ?? '',
    point: q.point ?? '',
    source_path: q.source_path ?? '',
    source_no: q.source_no ?? '',
  };
  if (withAnswer) {
    base.answer = q.answer;
    base.analysis = q.analysis;
  }
  return base;
}
