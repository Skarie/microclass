/**
 * 课时服务：列表（含进度）、详情（含知识点）、增删改、知识点、按文件夹批量导入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError, QUIZ_UNLOCK_RATIO } from '@microclass/shared';
import type { LessonRepository, LessonWithProgress } from '../db/repositories/lessonRepository.js';
import type { ProgressRepository } from '../db/repositories/progressRepository.js';
import { UPLOAD_ROOT_ID, type MediaRootService } from './mediaRootService.js';
import type { StorageService } from './storageService.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import { coveredSeconds, type WatchIntervalRepository } from '../db/repositories/watchIntervalRepository.js';
import type { MediaProbeService } from './mediaProbeService.js';
import { buildDocx, type DocxBlock } from '../utils/docx.js';
import type { Knowledge, Lesson, User } from '@microclass/shared';

export interface LessonInputDto {
  title: string;
  description?: string;
  videoKind: Lesson['video_kind'];
  mediaRoot?: string;
  videoPath: string;
  sort?: number;
  groupName?: string;
  courseId?: number | null;
  source?: 'manual' | 'folder';
}

/** 课程文件夹绑定信息（管理页展示用） */
export interface CourseFolderInfo {
  rootId: string;
  rootName: string;
  /** 媒体根下的相对路径（空串 = 根目录本身） */
  path: string;
  available: boolean;
  lastScanAt: number | null;
}

/** 课程文件夹扫描结果：dryRun 时只统计不写库 */
export interface CourseScanResult {
  dryRun: boolean;
  courseId: number;
  folder: CourseFolderInfo;
  /** 磁盘上扫描到的视频总数 */
  onDisk: number;
  folders: number;
  added: number;
  /** 原本挂在别的课程、被收编到本课程的课时数 */
  assigned: number;
  /** 章节名随文件夹同步更新的课时数 */
  updated: number;
  skipped: number;
  missing: { id: number; title: string; videoPath: string; source: 'manual' | 'folder' }[];
  removed: number;
  total: number;
  newLessonIds: number[];
}

export class LessonService {
  /** 后台抽取队列（进程内串行，见 probeQuietly 注释） */
  private probeQueue: number[] = [];
  private probeRunning = false;

  constructor(
    private readonly lessons: LessonRepository,
    private readonly progress: ProgressRepository,
    private readonly media: MediaRootService,
    private readonly audit: AuditRepository,
    private readonly storage: StorageService,
    private readonly courses: CourseRepository,
    private readonly intervals: WatchIntervalRepository,
    private readonly probe: MediaProbeService,
  ) {}

  listForViewer(viewer: User, courseId?: number | null): LessonWithProgress[] {
    const rows = courseId === undefined ? this.lessons.listAll() : this.lessons.listByCourse(courseId);
    return this.lessons.withProgress(rows, viewer.id);
  }

  detail(viewer: User, id: number): { lesson: LessonWithProgress; knowledge: unknown[] } {
    const lesson = this.lessons.findById(id);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    const [withProgress] = this.lessons.withProgress([lesson], viewer.id);
    return { lesson: withProgress ?? { ...lesson, progress: null }, knowledge: this.lessons.listKnowledge(id) };
  }

  /**
   * 本地视频是否已解锁刷题（嵌入/直链不限制）。
   *
   * 判定顺序（参考轻课堂：进度按「观看区间」记录，避免拖到最后就算看完）：
   *   1. 已完成标记；
   *   2. 去重后的观看区间总时长 / 视频总时长 ≥ 80%（总时长优先用 ffprobe 抽的 duration）；
   *   3. 回退到单一播放位置（历史数据或前端未上报区间时）。
   */
  isQuizUnlocked(viewer: User, lessonId: number): boolean {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (lesson.video_kind !== 'local') return true;
    if (viewer.role === 'admin' || viewer.role === 'teacher') return true;

    const p = this.progress.get(viewer.id, lessonId);
    if (p?.finished === 1) return true;

    const total = lesson.duration ?? p?.duration ?? 0;
    if (!(total > 0)) return false;

    // 只要上报过观看区间，就只按区间判定（忽略播放位置）：
    // 否则「拖到结尾」会把 position 拉满而误判为看完。
    const segments = this.intervals.list(viewer.id, lessonId);
    if (segments.length > 0) {
      const covered = coveredSeconds(segments.map((s) => ({ start_sec: s.start_sec, end_sec: s.end_sec })));
      return covered / total >= QUIZ_UNLOCK_RATIO;
    }

    // 无区间记录（老数据 / 旧客户端）才回退到位置判定
    const position = p?.position ?? 0;
    return position / total >= QUIZ_UNLOCK_RATIO;
  }

  create(actor: User, input: LessonInputDto): number {
    const normalized = normalizeLessonInput(input);
    this.validate(normalized);
    const id = this.lessons.create(normalized);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.create',
      targetType: 'lesson',
      targetId: id,
      detail: { title: normalized.title, videoKind: normalized.videoKind },
    });
    return id;
  }

  update(actor: User, id: number, input: LessonInputDto): void {
    const existing = this.lessons.findById(id);
    if (!existing) throw AppError.notFound('视频单元不存在');
    const normalized = normalizeLessonInput(input);
    this.validate(normalized);
    this.lessons.update(id, normalized);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.update',
      targetType: 'lesson',
      targetId: id,
    });
  }

  remove(actor: User, id: number): void {
    const existing = this.lessons.findById(id);
    if (!existing) throw AppError.notFound('视频单元不存在');
    this.lessons.delete(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.delete',
      targetType: 'lesson',
      targetId: id,
      detail: { title: existing.title },
    });
  }

  addKnowledge(
    actor: User,
    input: {
      lessonId: number;
      title: string;
      kind: 'text' | 'file' | 'link';
      content?: string;
      url?: string;
      fileName?: string;
      filePath?: string;
    },
  ): number {
    const lesson = this.lessons.findById(input.lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    const title = (input.title ?? '').trim();
    if (!title) throw AppError.badRequest('标题不能为空');
    if (input.kind === 'link' && !/^https?:\/\//i.test(input.url ?? ''))
      throw AppError.badRequest('链接必须以 http(s):// 开头');
    const id = this.lessons.createKnowledge({ ...input, title });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.create',
      targetType: 'knowledge',
      targetId: id,
      detail: { lessonId: input.lessonId, kind: input.kind },
    });
    return id;
  }

  removeKnowledge(actor: User, id: number): { filePath: string } {
    const row = this.lessons.findKnowledge(id);
    if (!row) throw AppError.notFound('知识点不存在');
    this.lessons.deleteKnowledge(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.delete',
      targetType: 'knowledge',
      targetId: id,
    });
    return { filePath: row.file_path };
  }

  /** 更新知识点：链接类型改 URL，其余类型改正文 */
  updateKnowledge(actor: User, id: number, input: { title?: string; content?: string; url?: string }): void {
    const row = this.lessons.findKnowledge(id);
    if (!row) throw AppError.notFound('知识点不存在');
    const title = String(input.title ?? row.title).trim() || row.title;
    if (row.kind === 'link') {
      const url = String(input.url ?? row.url);
      if (!/^https?:\/\//i.test(url)) throw AppError.badRequest('链接必须以 http(s):// 开头');
      this.lessons.updateKnowledge(id, { title, url });
    } else {
      this.lessons.updateKnowledge(id, { title, content: String(input.content ?? row.content) });
    }
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.update',
      targetType: 'knowledge',
      targetId: id,
    });
  }

  /** 上传知识点附件（课件/讲义等），落盘到 uploads/knowledge 并绑定课时 */
  uploadKnowledgeFile(
    actor: User,
    input: { lessonId: number; title?: string; fileName: string; data: Buffer },
  ): { id: number; fileName: string } {
    const lesson = this.lessons.findById(input.lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (!input.data || input.data.length === 0) throw AppError.badRequest('文件为空');
    const fileName = path.basename(String(input.fileName || 'file'));
    const saved = this.storage.save({
      subdir: 'knowledge',
      fileName,
      data: input.data,
    });
    const title = String(input.title ?? '').trim() || fileName || '知识点文件';
    const id = this.lessons.createKnowledge({
      lessonId: input.lessonId,
      title,
      kind: 'file',
      fileName,
      filePath: saved.relPath,
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'knowledge.upload',
      targetType: 'knowledge',
      targetId: id,
      detail: { lessonId: input.lessonId, fileName, size: saved.size },
    });
    return { id, fileName };
  }

  /**
   * 按文件夹批量导入：子文件夹 → 章节(group_name)，文件 → 课时。
   *
   * 章节命名规则（符合「我选中的文件夹就是这一章」的直觉）：
   *   - 扫描的是某个子文件夹时，该文件夹**自身**的直接视频 → 章节名取该文件夹名；
   *   - 更深的子文件夹 → 章节名取子文件夹名。
   *
   * 重复视频的处理（`onDuplicate`）：
   *   - `skip`（默认）：已存在同路径课时就跳过，计数进 `skipped`；
   *   - `assign`：把这些**已存在**的课时收编到目标课程（并统一章节），计数进 `assigned`。
   *     这解决了「先把视频全导进来，之后才建课程，再导入却一个都没归入」的问题。
   */
  importFromFolder(
    actor: User,
    input: { rootId: string; path?: string; courseId?: number | null; onDuplicate?: 'skip' | 'assign' },
  ): { added: number; skipped: number; assigned: number; folders: number } {
    const rel = (input.path ?? '').trim().replace(/^\/+|\/+$/g, '');
    // 选中的文件夹名（作为其直接下属视频的章节名）
    const selfName = rel === '' ? '' : (rel.split('/').pop() ?? '');
    const { folders } = this.media.scan(input.rootId, rel);
    const courseId = input.courseId ?? null;
    const claimExisting = input.onDuplicate === 'assign' && courseId !== null;
    let added = 0;
    let skipped = 0;
    let assigned = 0;
    let sort = 0;
    for (const folder of folders) {
      const chapter = folder.folder === '' ? selfName : folder.folder;
      const videos = naturalSort(folder.videos);
      for (const fileName of videos) {
        const videoPath = folder.folder ? `${folder.folder}/${fileName}` : fileName;
        const existing = this.lessons.findLocalByMediaPath(input.rootId, videoPath);
        if (existing) {
          if (claimExisting) {
            // 收编：把已存在的课时改绑到目标课程，并统一章节名
            this.lessons.batchAssign([existing.id], courseId, chapter);
            assigned++;
          } else {
            skipped++;
          }
          continue;
        }
        const title = fileName.replace(/\.[^.]+$/, '');
        this.lessons.create({
          title,
          videoKind: 'local',
          mediaRoot: input.rootId,
          videoPath,
          groupName: chapter,
          courseId,
          sort: sort++,
        });
        added++;
      }
    }
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.import_folder',
      targetType: 'media_root',
      targetId: input.rootId,
      detail: { added, skipped, assigned, courseId, path: rel, onDuplicate: input.onDuplicate ?? 'skip' },
    });
    return { added, skipped, assigned, folders: folders.length };
  }

  /**
   * 网页直接上传视频后创建课时（无需运维挂载宿主机目录）。
   *
   * @param input.relPath 上传时的相对路径（拖拽整个文件夹时来自浏览器），
   *                      用于自动推断章节：取其所在目录的第一段作为章节名。
   * @param input.groupName 显式指定章节；给了它就不看 relPath。
   */
  createFromUpload(
    actor: User,
    input: {
      title: string;
      videoPath: string;
      relPath?: string;
      groupName?: string;
      courseId?: number | null;
      sort?: number;
    },
  ): number {
    const title = (input.title ?? '').trim().replace(/\.[^.]+$/, '');
    if (!title) throw AppError.badRequest('标题不能为空');

    // 章节推断：显式指定 > 相对路径的顶层目录 > 空（未分章）
    let groupName = input.groupName?.trim() ?? '';
    if (!groupName && input.relPath) {
      const parts = input.relPath.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length > 1) groupName = (parts[0] ?? '').slice(0, 120);
    }

    const id = this.lessons.create({
      title: title.slice(0, 200),
      videoKind: 'local',
      mediaRoot: UPLOAD_ROOT_ID,
      videoPath: input.videoPath,
      groupName,
      courseId: this.resolveCourse(input.courseId ?? null),
      sort: Number.isInteger(input.sort) ? Number(input.sort) : 0,
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.upload',
      targetType: 'lesson',
      targetId: id,
      detail: { title: title.slice(0, 120), groupName, courseId: input.courseId ?? null },
    });
    return id;
  }

  /**
   * 抽取单个课时的视频元数据（时长/类型/封面）。
   * 环境里没有 ffprobe 时返回 available:false，不抛错（避免影响导入/上传主流程）。
   */
  async probeMetadata(
    actor: User,
    lessonId: number,
  ): Promise<{ available: boolean; duration: number | null; coverPath: string; mediaType: string }> {
    const lesson = this.lessons.findById(lessonId);
    if (!lesson) throw AppError.notFound('视频单元不存在');
    if (lesson.video_kind !== 'local') throw AppError.badRequest('只有本地视频需要抽取元数据');

    if (!(await this.probe.available())) {
      return { available: false, duration: null, coverPath: '', mediaType: lesson.media_type };
    }

    const { abs } = this.media.resolve(lesson.media_root, lesson.video_path);
    const result = await this.probe.probe(abs);
    if (!result) {
      // 抽取失败也写入 probed_at，避免后台任务反复重试同一个坏文件
      this.lessons.setProbeResult(lessonId, { duration: null, mediaType: lesson.media_type, coverPath: '' });
      return { available: true, duration: null, coverPath: '', mediaType: lesson.media_type };
    }

    const coverPath = result.coverRelPath ?? '';
    this.lessons.setProbeResult(lessonId, {
      duration: result.durationSec,
      mediaType: result.mediaType,
      coverPath,
    });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.probe',
      targetType: 'lesson',
      targetId: lessonId,
      detail: { duration: result.durationSec, mediaType: result.mediaType, cover: coverPath !== '' },
    });
    return { available: true, duration: result.durationSec, coverPath, mediaType: result.mediaType };
  }

  /**
   * 批量抽取：处理最多 limit 个还没抽过的本地视频，返回剩余数量供前端继续调用。
   * 单次别开太大：每个视频要 spawn 一次 ffprobe + 一次 ffmpeg 抽帧，
   * 20 个大约十几秒，前端会循环调用直到 remaining 为 0。
   */
  async probePending(
    actor: User,
    limit = 20,
  ): Promise<{ probed: number; failed: number; remaining: number; available: boolean }> {
    if (!(await this.probe.available())) return { probed: 0, failed: 0, remaining: 0, available: false };
    const pending = this.lessons.listPendingProbe(limit);
    let probed = 0;
    let failed = 0;
    for (const lesson of pending) {
      try {
        const res = await this.probeMetadata(actor, lesson.id);
        if (res.duration !== null) probed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { probed, failed, remaining: this.lessons.countPendingProbe(), available: true };
  }

  /**
   * 后台静默抽取（扫描/导入/上传后触发，不阻塞响应）。
   *
   * **必须串行**：一次批量导入会连着触发几十次扫描，如果每个扫描各自起 ffmpeg，
   * 几十个 ffmpeg 同时跑会直接把容器内存打爆（EVO4 上实测被 cgroup OOM kill 过一次）。
   * 所以这里用「队列 + 单个消费者」：同一时刻只有一个 ffprobe/ffmpeg 在跑，
   * 排在后面的 id 依次处理，队列上限 500 防止无界堆积。
   */
  async probeQuietly(lessonIds: number[]): Promise<void> {
    this.probeQueue.push(...lessonIds);
    if (this.probeQueue.length > 500) this.probeQueue = this.probeQueue.slice(-500);
    if (this.probeRunning) return;
    if (!(await this.probe.available())) {
      this.probeQueue = [];
      return;
    }

    this.probeRunning = true;
    try {
      while (this.probeQueue.length > 0) {
        const id = this.probeQueue.shift();
        if (id === undefined) break;
        try {
          const lesson = this.lessons.findById(id);
          if (!lesson || lesson.video_kind !== 'local' || lesson.probed_at !== null) continue;
          const { abs } = this.media.resolve(lesson.media_root, lesson.video_path);
          const result = await this.probe.probe(abs);
          this.lessons.setProbeResult(id, {
            duration: result?.durationSec ?? null,
            mediaType: result?.mediaType ?? 'video',
            coverPath: result?.coverRelPath ?? '',
          });
        } catch {
          /* 单个视频失败不影响后续 */
        }
      }
    } finally {
      this.probeRunning = false;
    }
  }

  /** 后台抽取是否还在跑（供运维/接口观察进度） */
  probeQueueStatus(): { running: boolean; queued: number } {
    return { running: this.probeRunning, queued: this.probeQueue.length };
  }

  /** 批量改绑归属：把选中的课时一次性挂到目标课程（courseId=null 表示移出课程回到「未归类」），
   * 可选统一章节名。常用于「先把视频全导进来，再按文件夹整理成课程」的场景。
   */
  batchAssign(
    actor: User,
    input: { lessonIds: number[]; courseId: number | null; groupName?: string },
  ): { updated: number; courseId: number | null; groupName: string | null } {
    const ids = [...new Set(input.lessonIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) throw AppError.badRequest('请选择要改绑的课时');
    if (ids.length > 2000) throw AppError.badRequest('一次最多改绑 2000 个课时');

    let courseId: number | null = null;
    if (input.courseId !== null && input.courseId !== undefined) {
      const parsed = Number(input.courseId);
      if (!Number.isInteger(parsed) || !this.courses.findById(parsed)) throw AppError.badRequest('目标课程不存在');
      courseId = parsed;
    }

    const groupName = input.groupName === undefined ? undefined : String(input.groupName).trim().slice(0, 120);
    const updated = this.lessons.batchAssign(ids, courseId, groupName);
    if (updated === 0) throw AppError.notFound('没有找到可改绑的课时');

    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.batch_assign',
      targetType: 'course',
      targetId: courseId === null ? 'orphan' : String(courseId),
      detail: { requested: ids.length, updated, groupName: groupName ?? null },
    });
    return { updated, courseId, groupName: groupName ?? null };
  }

  /* ------------------------------------------------------------------ *
   * 知识点讲义导出（Markdown / Word）
   * ------------------------------------------------------------------ */

  /**
   * 导出知识点讲义：`{ courseId }` 导整门课程（按章节 → 课时组织），`{ lessonId }` 只导一个课时。
   * 文本类知识点导出正文；链接类导出可点链接；附件类导出文件名（文件本身在课时页下载）。
   */
  knowledgeOutline(scope: { courseId?: number; lessonId?: number }): {
    title: string;
    subtitle: string;
    chapters: { chapter: string; lessons: { lesson: Lesson; items: Knowledge[] }[] }[];
    totalItems: number;
  } {
    let lessons: Lesson[] = [];
    let title = '';
    if (scope.lessonId !== undefined) {
      const lesson = this.lessons.findById(scope.lessonId);
      if (!lesson) throw AppError.notFound('课时不存在');
      lessons = [lesson];
      title = lesson.title;
    } else if (scope.courseId !== undefined) {
      const course = this.courses.findById(scope.courseId);
      if (!course) throw AppError.notFound('课程不存在');
      lessons = this.lessons.listByCourse(scope.courseId);
      title = course.name;
    } else {
      throw AppError.badRequest('必须指定课程或课时');
    }

    const chapters: { chapter: string; lessons: { lesson: Lesson; items: Knowledge[] }[] }[] = [];
    let totalItems = 0;
    for (const lesson of lessons) {
      const items = this.lessons.listKnowledge(lesson.id);
      totalItems += items.length;
      const chapterName = lesson.group_name || '未分章';
      let chapter = chapters.find((c) => c.chapter === chapterName);
      if (!chapter) {
        chapter = { chapter: chapterName, lessons: [] };
        chapters.push(chapter);
      }
      chapter.lessons.push({ lesson, items });
    }

    const lessonCount = lessons.length;
    return {
      title,
      subtitle: `微课堂导出 · ${lessonCount} 个课时 · ${totalItems} 条知识点`,
      chapters,
      totalItems,
    };
  }

  /** 知识点讲义 → Markdown（课程级按章节分层；单课时直接列知识点） */
  knowledgeToMarkdown(scope: { courseId?: number; lessonId?: number }): { filename: string; body: string } {
    const outline = this.knowledgeOutline(scope);
    const withChapters = scope.courseId !== undefined;
    const out: string[] = [`# ${outline.title} · 知识点讲义`, '', `> ${outline.subtitle}`, ''];

    for (const chapter of outline.chapters) {
      if (withChapters) out.push(`## ${chapter.chapter}`, '');
      for (const { lesson, items } of chapter.lessons) {
        if (withChapters) out.push(`### ${lesson.title}`, '');
        if (items.length === 0) {
          out.push('_（本课时暂无知识点）_', '');
          continue;
        }
        for (const item of items) {
          out.push(withChapters ? `**${item.title}**` : `## ${item.title}`, '');
          if (item.kind === 'link') out.push(`- 链接：<${item.url}>`);
          else if (item.kind === 'file') out.push(`- 附件：${item.file_name || item.title}（在微课堂课时页下载）`);
          else if (item.content.trim()) out.push(item.content.trim());
          out.push('');
        }
        out.push('---', '');
      }
    }
    return { filename: `${outline.title}_知识点.md`, body: out.join('\n') };
  }

  /** 知识点讲义 → Word（.docx，章节/课时分层标题） */
  knowledgeToDocx(scope: { courseId?: number; lessonId?: number }): { filename: string; body: Buffer } {
    const outline = this.knowledgeOutline(scope);
    const withChapters = scope.courseId !== undefined;
    const blocks: DocxBlock[] = [
      { type: 'title', text: `${outline.title} · 知识点讲义` },
      { type: 'subtitle', text: outline.subtitle },
    ];

    for (const chapter of outline.chapters) {
      if (withChapters) blocks.push({ type: 'heading', text: chapter.chapter });
      for (const { lesson, items } of chapter.lessons) {
        if (withChapters) blocks.push({ type: 'heading2', text: lesson.title });
        if (items.length === 0) {
          blocks.push({ type: 'analysis', text: '（本课时暂无知识点）' });
          continue;
        }
        for (const item of items) {
          blocks.push({ type: withChapters ? 'strong' : 'heading2', text: item.title });
          if (item.kind === 'link') blocks.push({ type: 'text', text: `链接：${item.url}` });
          else if (item.kind === 'file') {
            blocks.push({ type: 'text', text: `附件：${item.file_name || item.title}（在微课堂课时页下载）` });
          } else if (item.content.trim()) {
            blocks.push({ type: 'text', text: item.content.trim() });
          }
        }
      }
    }
    if (outline.totalItems === 0) {
      blocks.push({ type: 'analysis', text: '这门课程还没有任何知识点。' });
    }
    return {
      filename: `${outline.title}_知识点.docx`,
      body: buildDocx({ title: `${outline.title} 知识点讲义`, blocks, images: [] }),
    };
  }

  /* ------------------------------------------------------------------ *
   * 课程文件夹：绑定 → 扫描导入 → 重新扫描（用户的核心工作流）
   * ------------------------------------------------------------------ */

  /** 当前课程绑定的文件夹信息；未绑定返回 null */
  courseFolderInfo(courseId: number): CourseFolderInfo | null {
    const course = this.courses.findById(courseId);
    if (!course || !course.folder_root_id) return null;
    const root = this.media.list().find((r) => r.id === course.folder_root_id);
    return {
      rootId: course.folder_root_id,
      rootName: root?.name ?? course.folder_root_id,
      path: course.folder_path ?? '',
      available: root ? this.media.isAvailable(root) : false,
      lastScanAt: course.last_scan_at ?? null,
    };
  }

  /**
   * 绑定 / 更换 / 解绑课程文件夹（rootId 为 null 即解绑）。
   * 绑定只是记下目录，不导入任何课时 —— 导入由 `scanCourseFolder` 完成，
   * 这样「先建课程、再选目录、最后扫描」三步各自可控。
   */
  bindCourseFolder(
    actor: User,
    courseId: number,
    input: { rootId: string | null; path?: string },
  ): CourseFolderInfo | null {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');

    if (input.rootId === null || input.rootId === undefined) {
      this.courses.setFolder(courseId, null, null);
      this.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'course.folder_unbind',
        targetType: 'course',
        targetId: courseId,
        detail: { name: course.name },
      });
      return null;
    }

    const root = this.media.list().find((r) => r.id === input.rootId);
    if (!root) throw AppError.badRequest('媒体目录不存在，请先在「媒体目录」里添加');
    if (!this.media.isAvailable(root)) {
      throw AppError.badRequest(`媒体目录不可访问：${root.path}（Docker 版需先把宿主机文件夹挂载进容器）`);
    }

    const rel = String(input.path ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    // resolve 会拦掉 ../ 越界；随后确认确实是个目录
    const { abs } = this.media.resolve(root.id, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw AppError.badRequest(`文件夹不存在或不可访问：${rel === '' ? root.path : `${root.path}/${rel}`}`);
    }
    const owner = this.courses.findFolderOwner(root.id, rel, courseId);
    if (owner) throw AppError.conflict(`该文件夹已绑定到课程「${owner.name}」，一个文件夹只能对应一门课程`);

    this.courses.setFolder(courseId, root.id, rel);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.folder_bind',
      targetType: 'course',
      targetId: courseId,
      detail: { rootId: root.id, path: rel },
    });
    return this.courseFolderInfo(courseId);
  }

  /**
   * 扫描课程文件夹并导入课时（用户说「以后加了新课，扫描一下就好」）。
   *
   * 规则（都写进 docs/usage.md，避免与「批量改绑」混淆）：
   *   - 章节名默认取课程文件夹下的**第一层**目录（`chapterMode` 可改成完整路径或不设章节）；
   *     课程文件夹根目录下的视频 → 章节为空（未分章）；
   *   - 已在别门课程下的同路径课时 → **收编**到本课程（`onDuplicate:'skip'` 可关闭）；
   *   - `source='folder'` 的课时：章节名跟随文件夹同步；文件已从磁盘消失时可被清理；
   *   - `source='manual'`（手工建 / 网页上传）的课时绝不自动删除，只提示「文件已不在磁盘上」；
   *   - 新增课时插到「同章节最后一条之后」（没有该章节则追加到末尾），
   *     这样老师手工拖拽调好的顺序不会被下一次扫描打乱。
   */
  scanCourseFolder(
    actor: User,
    courseId: number,
    input: {
      dryRun?: boolean;
      removeMissing?: boolean;
      onDuplicate?: 'skip' | 'assign';
      /** 章节怎么定：first（默认，第一层目录）/ full（完整目录路径）/ none（不设章节） */
      chapterMode?: 'first' | 'full' | 'none';
    } = {},
  ): CourseScanResult {
    const dryRun = input.dryRun === true;
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const folder = this.courseFolderInfo(courseId);
    if (!folder) throw AppError.badRequest('该课程还没有绑定视频文件夹，请先选择文件夹并绑定');
    if (!folder.available) throw AppError.badRequest(`媒体目录不可访问：${folder.rootName}，请检查挂载或权限`);

    const { folders } = this.media.scan(folder.rootId, folder.path);
    const existing = this.lessons.listByRootPrefix(folder.rootId, folder.path);
    const byPath = new Map(existing.filter((l) => l.video_kind === 'local').map((l) => [l.video_path, l]));

    /**
     * 章节怎么定（默认取课程文件夹下的**第一层**目录）：
     *   - `first`：`第一章 有理数/3.1 乘方/xx.mp4` → 章节「第一章 有理数」（素材常按「章/节/视频」多层放，
     *     若取完整路径会变成一节一个章节，列表反而没法看）
     *   - `full` ：章节 = 相对课程文件夹的完整目录路径
     *   - `none` ：不设章节（全部归入「未分章」）
     */
    const chapterMode = input.chapterMode ?? 'first';
    const chapterOf = (relDir: string): string => {
      if (chapterMode === 'none' || relDir === '') return '';
      if (chapterMode === 'full') return relDir;
      return relDir.split('/')[0] ?? '';
    };

    const onDisk = new Set<string>();
    const planned: { videoPath: string; chapter: string; title: string }[] = [];
    const steal: number[] = [];
    const sync: { id: number; chapter: string }[] = [];
    let assigned = 0;
    let updated = 0;
    let skipped = 0;

    for (const scanned of folders) {
      const chapter = chapterOf(scanned.folder);
      for (const fileName of naturalSort(scanned.videos)) {
        // video_path 必须是**相对媒体根**的路径（播放时用 mediaRoot + videoPath 定位文件），
        // 所以课程文件夹本身的那一层要带上；chapter 则是相对课程文件夹的
        const dir = joinRel(folder.path, scanned.folder);
        const videoPath = dir === '' ? fileName : `${dir}/${fileName}`;
        onDisk.add(videoPath);
        const hit = byPath.get(videoPath);
        if (!hit) {
          planned.push({ videoPath, chapter, title: fileName.replace(/\.[^.]+$/, '') });
          continue;
        }
        if (hit.course_id !== courseId) {
          if (input.onDuplicate === 'skip') {
            skipped += 1;
          } else {
            assigned += 1;
            steal.push(hit.id);
          }
          continue;
        }
        if (hit.source !== 'manual' && hit.group_name !== chapter) {
          updated += 1;
          sync.push({ id: hit.id, chapter });
          continue;
        }
        skipped += 1;
      }
    }

    // 磁盘上已消失的课时（只统计本课程、且路径落在该文件夹下的本地视频）
    const missing: CourseScanResult['missing'] = [];
    for (const lesson of existing) {
      if (lesson.course_id !== courseId || lesson.video_kind !== 'local') continue;
      if (onDisk.has(lesson.video_path)) continue;
      try {
        const { abs } = this.media.resolve(folder.rootId, lesson.video_path);
        if (fs.existsSync(abs)) continue;
      } catch {
        /* 解析失败（目录被移除等）也按缺失处理 */
      }
      const source: 'manual' | 'folder' = lesson.source === 'folder' ? 'folder' : 'manual';
      missing.push({ id: lesson.id, title: lesson.title, videoPath: lesson.video_path, source });
    }

    const removable = missing.filter((m) => m.source === 'folder');
    const wouldRemove = input.removeMissing === true ? removable.length : 0;
    const onDiskCount = folders.reduce((acc, f) => acc + f.count, 0);

    if (dryRun) {
      return {
        dryRun: true,
        courseId,
        folder,
        onDisk: onDiskCount,
        folders: folders.length,
        added: planned.length,
        assigned,
        updated,
        skipped,
        missing,
        removed: 0,
        total: this.lessons.countByCourse(courseId) + planned.length + assigned - wouldRemove,
        newLessonIds: [],
      };
    }

    if (steal.length > 0) this.lessons.batchAssign(steal, courseId);
    for (const item of sync) this.lessons.markFromFolder(item.id, item.chapter);

    let removed = 0;
    if (input.removeMissing === true) {
      removed = this.lessons.deleteMany(removable.map((m) => m.id));
    }

    const newLessonIds = this.createScannedLessons(courseId, folder.rootId, planned);
    this.courses.markScanned(courseId);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.folder_scan',
      targetType: 'course',
      targetId: courseId,
      detail: {
        rootId: folder.rootId,
        path: folder.path,
        onDisk: onDiskCount,
        added: planned.length,
        assigned,
        updated,
        skipped,
        removed,
        missing: missing.length,
      },
    });

    return {
      dryRun: false,
      courseId,
      folder: this.courseFolderInfo(courseId) ?? folder,
      onDisk: onDiskCount,
      folders: folders.length,
      added: newLessonIds.length,
      assigned,
      updated,
      skipped,
      missing,
      removed,
      total: this.lessons.countByCourse(courseId),
      newLessonIds,
    };
  }

  /** 批量保存课程内的课时顺序（拖拽排序） */
  reorderLessons(actor: User, courseId: number, ids: number[]): { updated: number } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const current = this.lessons.listByCourse(courseId).map((l) => l.id);
    if (current.length === 0) throw AppError.badRequest('该课程还没有课时');
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw AppError.badRequest('排序列表里有重复的课时');
    const same = unique.length === current.length && unique.every((id) => current.includes(id));
    if (!same) {
      throw AppError.badRequest('排序列表与课程当前课时不一致，请刷新页面后重试');
    }
    const updated = this.lessons.reorder(unique);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'lesson.reorder',
      targetType: 'course',
      targetId: courseId,
      detail: { lessons: unique.length },
    });
    return { updated };
  }

  /** 为扫描到的视频建课时，并把它们插进对应章节的末尾 */
  private createScannedLessons(
    courseId: number,
    rootId: string,
    planned: { videoPath: string; chapter: string; title: string }[],
  ): number[] {
    if (planned.length === 0) return [];
    const ordered = this.lessons.listByCourse(courseId);
    const layout: { id: number; chapter: string }[] = ordered.map((l) => ({ id: l.id, chapter: l.group_name }));
    let sort = this.lessons.maxSort(courseId) + 1;
    const createdIds: number[] = [];
    for (const item of planned) {
      const id = this.lessons.create({
        title: item.title.slice(0, 200),
        videoKind: 'local',
        mediaRoot: rootId,
        videoPath: item.videoPath,
        groupName: item.chapter,
        courseId,
        sort: sort++,
        source: 'folder',
      });
      createdIds.push(id);
      // 插入点：同章节最后一条之后；本课程还没有这个章节就追加到末尾
      let anchor = layout.length - 1;
      for (let i = layout.length - 1; i >= 0; i -= 1) {
        if (layout[i]?.chapter === item.chapter) {
          anchor = i;
          break;
        }
      }
      layout.splice(anchor + 1, 0, { id, chapter: item.chapter });
    }
    this.lessons.reorder(layout.map((l) => l.id));
    return createdIds;
  }

  private resolveCourse(courseId: number | null): number | null {
    if (courseId === null) return null;
    if (!this.courses.findById(courseId)) throw AppError.badRequest('目标课程不存在');
    return courseId;
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
}

/**
 * 课时入参归一化：外部视频（嵌入 / 直链）先把地址洗干净再落库。
 *
 * 老师在 B 站 / 腾讯视频等平台复制到的是**整段嵌入代码**：
 *   `<iframe src="//player.bilibili.com/player.html?bvid=BV1xx" ...></iframe>`
 * 直接存进去浏览器是播不了的，所以这里统一取出 `src` 并把协议相对地址（`//…`）补成 `https://`。
 * 本地视频原样返回。
 */
function normalizeLessonInput(input: LessonInputDto): LessonInputDto {
  if (input.videoKind === 'local') return input;
  const normalized = normalizeExternalVideoUrl(input.videoPath ?? '');
  return { ...input, videoPath: normalized ?? String(input.videoPath ?? '').trim() };
}

/**
 * 把「平台嵌入代码 / 地址」归一化成可用的 http(s) 地址；不是可用地址时返回 null。
 * 同时接受：整段 `<iframe …>` 代码、`//host/path` 协议相对地址、普通 http(s) 地址。
 */
export function normalizeExternalVideoUrl(raw: string): string | null {
  let value = String(raw ?? '').trim();
  if (!value) return null;

  const iframe = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(value);
  if (iframe?.[1]) {
    value = iframe[1].trim();
  } else if (/<iframe/i.test(value)) {
    // 粘了一段 iframe 代码但里面没有 src
    return null;
  }

  if (value.startsWith('//')) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  if (value.length > 1000) return null;
  return value;
}

/**
 * 文件名自然序：`2. xxx.mp4` 要排在 `10. xxx.mp4` 前面。
 * 素材文件名普遍带序号，字典序会把列表排成 1, 10, 11, 2…（轻课堂的 sort_order 同理）。
 */
function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

/** 拼接相对路径片段，自动忽略空段（不用 path.join，避免 Windows 上出现反斜杠） */
function joinRel(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}
