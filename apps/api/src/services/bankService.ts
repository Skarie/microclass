/** 题库服务入口：题库 CRUD 与领域编排；其它职责已拆到同目录服务，对外签名与返回结构不变。 */
import { AppError, type User } from '@microclass/shared';
import type { BankKind, BankListFilter, BankRepository, BankWithStats } from '../db/repositories/bankRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import { toViewer, type QuestionForViewer } from '../domain/questionView.js';
import type { BankDto } from './bankTypes.js';
import { resolveLessonId } from './bankQuestionInput.js';
import type { StorageService } from './storageService.js';
import type { QuestionMediaStore } from './questionMediaStore.js';
import type { DifficultyService } from './difficultyService.js';
import { BankCatalogService } from './bankCatalogService.js';
import { BankExportService } from './bankExportService.js';
import { BankHealthService } from './bankHealthService.js';
import { BankImportService } from './bankImportService.js';
import { BankManifestImportService } from './bankManifestImportService.js';
import { BankQuestionImageService } from './bankQuestionImageService.js';
import { BankQuestionService } from './bankQuestionService.js';
import { BankSectionService, resolveSection } from './bankSectionService.js';
import { BankTemplateService } from './bankTemplateService.js';

export type { BankDto, QuestionDto } from './bankTypes.js';
export type { QuestionForViewer } from '../domain/questionView.js';
export { toViewer } from '../domain/questionView.js';
export type { BankHealthResult } from './bankHealthService.js';
export type { BackfillSectionsResult } from './bankSectionService.js';

export class BankService {
  private readonly bankCatalog: BankCatalogService;
  private readonly bankSections: BankSectionService;
  private readonly bankQuestions: BankQuestionService;
  private readonly bankImages: BankQuestionImageService;
  private readonly bankImports: BankImportService;
  private readonly manifestImports: BankManifestImportService;
  private readonly bankExports: BankExportService;
  private readonly bankTemplates = new BankTemplateService();
  private readonly bankHealth: BankHealthService;

  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly lessons: LessonRepository,
    private readonly audit: AuditRepository,
    storage: StorageService,
    media: QuestionMediaStore,
    difficulty: DifficultyService,
  ) {
    this.bankCatalog = new BankCatalogService(banks, questions, audit);
    this.bankSections = new BankSectionService(banks, audit);
    this.bankQuestions = new BankQuestionService(banks, questions, lessons, storage, audit);
    this.bankImages = new BankQuestionImageService(banks, questions, audit, storage);
    this.bankHealth = new BankHealthService(banks, questions, difficulty, audit);
    this.bankImports = new BankImportService(banks, questions, storage, audit);
    this.manifestImports = new BankManifestImportService(banks, audit, media, this.bankQuestions, this.bankImages);
    this.bankExports = new BankExportService(banks, questions, media, this.bankImages);
  }

  list(options?: BankListFilter): BankWithStats[] {
    return this.banks.list(options);
  }

  /** 当前筛选条件下的题库总数（配合分页） */
  countBanks(options?: BankListFilter): number {
    return this.banks.count(options);
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
    const lessonId = resolveLessonId(this.lessons, input.lessonId);
    const lesson = lessonId === null ? undefined : this.lessons.findById(lessonId);
    // 课程归属：显式 courseId 优先；否则有课时就跟课时的课程；都没有则不归属。
    const explicitCourse =
      input.courseId === undefined ? undefined : input.courseId === null ? null : Number(input.courseId);
    const courseId = explicitCourse !== undefined ? explicitCourse : (lesson?.course_id ?? null);
    // 章节：入参优先，空串时继承课时 group_name；只给 courseId 不给 lessonId 不强推。
    const section = resolveSection(input.section, lesson?.group_name);
    const id = this.banks.create({
      name,
      lessonId,
      courseId,
      section,
      ...(input.kind ? { kind: input.kind as BankKind } : {}),
      ...(input.subject ? { subject: String(input.subject) } : {}),
      ...(input.book ? { book: String(input.book) } : {}),
    });
    this.auditWrite(actor, 'bank.create', 'bank', id, { name, lessonId, courseId });
    return id;
  }

  update(actor: User, id: number, input: BankDto): void {
    const bank = this.banks.findById(id);
    if (!bank) throw AppError.notFound('题库不存在');
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('题库名称不能为空');
    const lessonId = resolveLessonId(this.lessons, input.lessonId);
    const lesson = lessonId === null ? undefined : this.lessons.findById(lessonId);
    // 课程归属：显式 courseId 优先；否则课时变了就跟课时的课程；都没动则保持原值。
    const explicitCourse =
      input.courseId === undefined ? undefined : input.courseId === null ? null : Number(input.courseId);
    const derivedCourse =
      explicitCourse !== undefined
        ? explicitCourse
        : lessonId !== null && lessonId !== bank.lesson_id
          ? (lesson?.course_id ?? null)
          : undefined;
    // 章节：显式传了（含空串）就按传入值；没传保留原值；为空/被清空则重新继承课时 group_name。
    const section = resolveSection(input.section, lesson?.group_name, bank.section);
    this.banks.update(id, {
      name,
      lessonId,
      section,
      ...(derivedCourse === undefined ? {} : { courseId: derivedCourse }),
      ...(input.subject === undefined ? {} : { subject: String(input.subject) }),
      ...(input.book === undefined ? {} : { book: String(input.book) }),
      ...(input.kind ? { kind: input.kind as BankKind } : {}),
    });
    this.auditWrite(actor, 'bank.update', 'bank', id);
  }

  remove(actor: User, id: number): void {
    const bank = this.banks.findById(id);
    if (!bank) throw AppError.notFound('题库不存在');
    // 题目随题库级联删除（ON DELETE CASCADE）
    this.banks.delete(id);
    this.auditWrite(actor, 'bank.delete', 'bank', id, { name: bank.name });
  }

  /** 统一写审计：让 CRUD 方法只保留业务差异 */
  private auditWrite(actor: User, action: string, targetType: string, targetId: number, detail?: unknown): void {
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action,
      targetType,
      targetId,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  readonly catalog = (...args: Parameters<BankCatalogService['catalog']>) => this.bankCatalog.catalog(...args);
  readonly catalogCourse = (...args: Parameters<BankCatalogService['catalogCourse']>) =>
    this.bankCatalog.catalogCourse(...args);
  readonly bindUnboundByBook = (...args: Parameters<BankCatalogService['bindUnboundByBook']>) =>
    this.bankCatalog.bindUnboundByBook(...args);
  readonly rebindCourses = (...args: Parameters<BankCatalogService['rebindCourses']>) =>
    this.bankCatalog.rebindCourses(...args);
  readonly createExamFromBank = (...args: Parameters<BankCatalogService['createExamFromBank']>) =>
    this.bankCatalog.createExamFromBank(...args);
  readonly catalogSections = (...args: Parameters<BankSectionService['catalogSections']>) =>
    this.bankSections.catalogSections(...args);
  readonly backfillSections = (...args: Parameters<BankSectionService['backfillSections']>) =>
    this.bankSections.backfillSections(...args);
  readonly health = (...args: Parameters<BankHealthService['health']>) => this.bankHealth.health(...args);
  readonly dedupeBank = (...args: Parameters<BankHealthService['dedupeBank']>) => this.bankHealth.dedupeBank(...args);
  readonly listQuestions = (...args: Parameters<BankQuestionService['listQuestions']>) =>
    this.bankQuestions.listQuestions(...args);
  readonly findQuestion = (...args: Parameters<BankQuestionService['findQuestion']>) =>
    this.bankQuestions.findQuestion(...args);
  readonly createQuestion = (...args: Parameters<BankQuestionService['createQuestion']>) =>
    this.bankQuestions.createQuestion(...args);
  readonly updateQuestion = (...args: Parameters<BankQuestionService['updateQuestion']>) =>
    this.bankQuestions.updateQuestion(...args);
  readonly removeQuestion = (...args: Parameters<BankQuestionService['removeQuestion']>) =>
    this.bankQuestions.removeQuestion(...args);
  readonly removeQuestions = (...args: Parameters<BankQuestionService['removeQuestions']>) =>
    this.bankQuestions.removeQuestions(...args);
  readonly setQuestionsDifficulty = (...args: Parameters<BankQuestionService['setQuestionsDifficulty']>) =>
    this.bankQuestions.setQuestionsDifficulty(...args);
  readonly searchQuestions = (...args: Parameters<BankQuestionService['searchQuestions']>) =>
    this.bankQuestions.searchQuestions(...args);
  readonly createImageQuestion = (...args: Parameters<BankQuestionImageService['createImageQuestion']>) =>
    this.bankImages.createImageQuestion(...args);
  readonly attachImage = (...args: Parameters<BankQuestionImageService['attachImage']>) =>
    this.bankImages.attachImage(...args);
  readonly resolveImage = (...args: Parameters<BankQuestionImageService['resolveImage']>) =>
    this.bankImages.resolveImage(...args);
  readonly importQuestions = (...args: Parameters<BankManifestImportService['importQuestions']>) =>
    this.manifestImports.importQuestions(...args);
  readonly importFile = (...args: Parameters<BankImportService['importFile']>) => this.bankImports.importFile(...args);
  readonly importText = (...args: Parameters<BankImportService['importText']>) => this.bankImports.importText(...args);
  readonly importCsv = (...args: Parameters<BankImportService['importCsv']>) => this.bankImports.importCsv(...args);
  readonly exportCsv = (...args: Parameters<BankExportService['exportCsv']>) => this.bankExports.exportCsv(...args);
  readonly exportMarkdown = (...args: Parameters<BankExportService['exportMarkdown']>) =>
    this.bankExports.exportMarkdown(...args);
  readonly exportDocx = (...args: Parameters<BankExportService['exportDocx']>) => this.bankExports.exportDocx(...args);
  readonly templateCsv = (...args: Parameters<BankTemplateService['templateCsv']>) =>
    this.bankTemplates.templateCsv(...args);
  readonly templateMarkdown = (...args: Parameters<BankTemplateService['templateMarkdown']>) =>
    this.bankTemplates.templateMarkdown(...args);
}
