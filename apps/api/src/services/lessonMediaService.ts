/**
 * 课时视频上传入库与元数据抽取：网页上传建课时、ffprobe 时长/封面、
 * 后台串行抽取队列。不负责课程文件夹扫描。
 */
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import { UPLOAD_ROOT_ID, type MediaRootService } from './mediaRootService.js';
import type { MediaProbeService } from './mediaProbeService.js';
import type { LessonProbePendingResult, LessonProbeResult, UploadLessonInput } from './lessonTypes.js';
import { inferUploadGroupName, normalizeUploadTitle } from './lessonInput.js';

export class LessonMediaService {
  /** 后台抽取队列（进程内串行，见 probeQuietly 注释） */
  private probeQueue: number[] = [];
  private probeRunning = false;

  constructor(
    private readonly lessons: LessonRepository,
    private readonly media: MediaRootService,
    private readonly audit: AuditRepository,
    private readonly courses: CourseRepository,
    private readonly probe: MediaProbeService,
  ) {}

  /**
   * 网页直接上传视频后创建课时（无需运维挂载宿主机目录）。
   *
   * @param input.relPath 上传时的相对路径（拖拽整个文件夹时来自浏览器），
   *                      用于自动推断章节：取其所在目录的第一段作为章节名。
   * @param input.groupName 显式指定章节；给了它就不看 relPath。
   */
  createFromUpload(actor: User, input: UploadLessonInput): number {
    const title = normalizeUploadTitle(input.title);
    if (!title) throw AppError.badRequest('标题不能为空');

    // 章节推断：显式指定 > 相对路径的顶层目录 > 空（未分章）
    const groupName = inferUploadGroupName(input.groupName, input.relPath);

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
  async probeMetadata(actor: User, lessonId: number): Promise<LessonProbeResult> {
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
  async probePending(actor: User, limit = 20): Promise<LessonProbePendingResult> {
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

  private resolveCourse(courseId: number | null): number | null {
    if (courseId === null) return null;
    if (!this.courses.findById(courseId)) throw AppError.badRequest('目标课程不存在');
    return courseId;
  }
}
