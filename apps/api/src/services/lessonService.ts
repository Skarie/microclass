import { sortLessonsByChapter } from '../domain/lessonChapterOrder.js';
/**
 * 课时服务入口：课时列表/详情、增删改、刷题解锁与领域编排。
 * 其它职责已拆到同目录服务，对外方法签名与返回结构不变。
 *
 * lessons/courses 域迁到 `AsyncDb` 后，凡落到这两个仓储的方法都改为 async（调用点补 await）。
 */
import fs from 'node:fs';
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository, LessonWithProgress } from '../db/repositories/lessonRepository.js';
import type { KnowledgeRepository } from '../db/repositories/knowledgeRepository.js';
import type { KnowledgeRow } from '../domain/knowledgeTypes.js';
import type { ProgressRepository } from '../db/repositories/progressRepository.js';
import type { MediaRootService } from './mediaRootService.js';
import type { StorageService } from './storageService.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { WatchIntervalRepository } from '../db/repositories/watchIntervalRepository.js';
import type { MediaProbeService } from './mediaProbeService.js';
import { normalizeLessonInput } from './lessonInput.js';
import type {
  CourseFolderInfo,
  CourseScanInput,
  CourseScanResult,
  KnowledgeInput,
  KnowledgeOutline,
  LessonInputDto,
  LessonProbePendingResult,
  LessonProbeResult,
  UploadKnowledgeFileInput,
  UploadLessonInput,
} from './lessonTypes.js';
import { LessonFolderService, type ImportFolderInput, type ImportFolderResult } from './lessonFolderService.js';
import { LessonKnowledgeExportService } from './lessonKnowledgeExportService.js';
import { LessonKnowledgeService } from './lessonKnowledgeService.js';
import { LessonMediaService } from './lessonMediaService.js';
import { LessonOrderService } from './lessonOrderService.js';
import { LessonScanService } from './lessonScanService.js';
import { LessonUnlockService } from './lessonUnlockService.js';

export type { LessonInputDto, CourseFolderInfo, CourseScanResult } from './lessonTypes.js';
export { normalizeExternalVideoUrl } from './lessonInput.js';

export class LessonService {
  private readonly knowledge: LessonKnowledgeService;
  private readonly knowledgeExport: LessonKnowledgeExportService;
  private readonly mediaOps: LessonMediaService;
  private readonly folders: LessonFolderService;
  private readonly scans: LessonScanService;
  private readonly order: LessonOrderService;
  private readonly unlock: LessonUnlockService;

  constructor(
    private readonly lessons: LessonRepository,
    private readonly knowledgeRepo: KnowledgeRepository,
    progress: ProgressRepository,
    private readonly media: MediaRootService,
    private readonly audit: AuditRepository,
    storage: StorageService,
    courses: CourseRepository,
    intervals: WatchIntervalRepository,
    probe: MediaProbeService,
  ) {
    this.unlock = new LessonUnlockService(lessons, progress, intervals);
    this.knowledge = new LessonKnowledgeService(lessons, knowledgeRepo, audit, storage);
    this.knowledgeExport = new LessonKnowledgeExportService(lessons, knowledgeRepo, courses);
    this.mediaOps = new LessonMediaService(lessons, media, audit, courses, probe);
    this.folders = new LessonFolderService(lessons, media, courses, audit);
    this.scans = new LessonScanService(lessons, media, courses, audit, this.folders);
    this.order = new LessonOrderService(lessons, courses, audit);
  }

  async listForViewer(
    viewer: User,
    courseId?: number | null,
    options: { chapterOrder?: boolean } = {},
  ): Promise<LessonWithProgress[]> {
    const rows = courseId === undefined ? await this.lessons.listAll() : await this.lessons.listByCourse(courseId);
    /**
     * 单课程视图按章节序号排（导入顺序常是文件名字典序，会出现「一、三、二」这种乱序）。
     * 管理端要保留老师拖拽后的手动顺序，所以传 chapterOrder: false 关掉。
     */
    const ordered = typeof courseId === 'number' && options.chapterOrder !== false ? sortLessonsByChapter(rows) : rows;
    return this.lessons.withProgress(ordered, viewer.id);
  }

  async detail(
    viewer: User,
    id: number,
  ): Promise<{ lesson: LessonWithProgress; knowledge: KnowledgeRow[]; courseKnowledge: KnowledgeRow[] }> {
    const lesson = await this.lessons.findById(id);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    const [withProgress] = await this.lessons.withProgress([lesson], viewer.id);
    return {
      lesson: withProgress ?? { ...lesson, progress: null },
      knowledge: await this.knowledgeRepo.listByLesson(id),
      // 观看页展示该课时所属课程的「课程级共享知识点」；未归类课时为空
      courseKnowledge: lesson.course_id === null ? [] : await this.knowledgeRepo.listByCourse(lesson.course_id),
    };
  }

  /** 本地视频是否已解锁刷题；判定细节见 LessonUnlockService */
  isQuizUnlocked(viewer: User, lessonId: number): Promise<boolean> {
    return this.unlock.isQuizUnlocked(viewer, lessonId);
  }

  async create(actor: User, input: LessonInputDto): Promise<number> {
    const normalized = normalizeLessonInput(input);
    this.validate(normalized);
    const id = await this.lessons.create(normalized);
    this.auditWrite(actor, 'lesson.create', 'lesson', id, { title: normalized.title, videoKind: normalized.videoKind });
    return id;
  }
  async update(actor: User, id: number, input: LessonInputDto): Promise<void> {
    const existing = await this.lessons.findById(id);
    if (!existing) throw AppError.notFound('视频单元不存在');
    const normalized = normalizeLessonInput(input);
    this.validate(normalized);
    await this.lessons.update(id, normalized);
    this.auditWrite(actor, 'lesson.update', 'lesson', id);
  }

  async remove(actor: User, id: number): Promise<void> {
    const existing = await this.lessons.findById(id);
    if (!existing) throw AppError.notFound('视频单元不存在');
    await this.lessons.delete(id);
    this.auditWrite(actor, 'lesson.delete', 'lesson', id, { title: existing.title });
  }

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

  private validate(input: LessonInputDto): void {
    const title = (input.title ?? '').trim();
    if (!title) throw AppError.badRequest('标题不能为空');
    if (!input.videoKind) throw AppError.badRequest('缺少视频来源类型');
    if (input.videoKind === 'local') {
      if (!input.mediaRoot || !input.videoPath) throw AppError.badRequest('请选择媒体目录与视频文件');
      const { abs } = this.media.resolve(input.mediaRoot, input.videoPath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw AppError.badRequest('视频文件不存在或不可访问');
      }
    } else if (!/^https?:\/\//i.test(input.videoPath ?? '')) {
      throw AppError.badRequest('链接必须以 http(s):// 开头（也可以直接粘贴平台给的 <iframe> 嵌入代码）');
    }
  }

  addKnowledge(actor: User, input: KnowledgeInput): Promise<number> {
    return this.knowledge.addKnowledge(actor, input);
  }
  removeKnowledge(actor: User, id: number): Promise<{ filePath: string }> {
    return this.knowledge.removeKnowledge(actor, id);
  }
  updateKnowledge(actor: User, id: number, input: { title?: string; content?: string; url?: string }): Promise<void> {
    return this.knowledge.updateKnowledge(actor, id, input);
  }
  uploadKnowledgeFile(actor: User, input: UploadKnowledgeFileInput): Promise<{ id: number; fileName: string }> {
    return this.knowledge.uploadKnowledgeFile(actor, input);
  }
  knowledgeOutline(scope: { courseId?: number; lessonId?: number }): Promise<KnowledgeOutline> {
    return this.knowledgeExport.knowledgeOutline(scope);
  }
  knowledgeToMarkdown(scope: { courseId?: number; lessonId?: number }): Promise<{ filename: string; body: string }> {
    return this.knowledgeExport.knowledgeToMarkdown(scope);
  }
  knowledgeToDocx(scope: { courseId?: number; lessonId?: number }): Promise<{ filename: string; body: Buffer }> {
    return this.knowledgeExport.knowledgeToDocx(scope);
  }
  createFromUpload(actor: User, input: UploadLessonInput): Promise<number> {
    return this.mediaOps.createFromUpload(actor, input);
  }
  probeMetadata(actor: User, lessonId: number): Promise<LessonProbeResult> {
    return this.mediaOps.probeMetadata(actor, lessonId);
  }
  probePending(actor: User, limit = 20): Promise<LessonProbePendingResult> {
    return this.mediaOps.probePending(actor, limit);
  }
  probeQuietly(lessonIds: number[]): Promise<void> {
    return this.mediaOps.probeQuietly(lessonIds);
  }
  probeQueueStatus(): { running: boolean; queued: number } {
    return this.mediaOps.probeQueueStatus();
  }
  importFromFolder(actor: User, input: ImportFolderInput): Promise<ImportFolderResult> {
    return this.folders.importFromFolder(actor, input);
  }
  courseFolderInfo(courseId: number): Promise<CourseFolderInfo | null> {
    return this.folders.courseFolderInfo(courseId);
  }
  bindCourseFolder(
    actor: User,
    courseId: number,
    input: { rootId: string | null; path?: string },
  ): Promise<CourseFolderInfo | null> {
    return this.folders.bindCourseFolder(actor, courseId, input);
  }
  scanCourseFolder(actor: User, courseId: number, input: CourseScanInput = {}): Promise<CourseScanResult> {
    return this.scans.scanCourseFolder(actor, courseId, input);
  }
  batchAssign(
    actor: User,
    input: { lessonIds: number[]; courseId: number | null; groupName?: string },
  ): Promise<{ updated: number; courseId: number | null; groupName: string | null }> {
    return this.order.batchAssign(actor, input);
  }
  reorderLessons(actor: User, courseId: number, ids: number[]): Promise<{ updated: number }> {
    return this.order.reorderLessons(actor, courseId, ids);
  }
}
