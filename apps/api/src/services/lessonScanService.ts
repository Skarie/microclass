/**
 * 课程文件夹扫描：校验绑定 → 规划（纯逻辑在 lessonScanPlan）→ 落库
 * （收编、章节同步、缺失清理、按章节插入新课时）。
 */
import fs from 'node:fs';
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { MediaRootService } from './mediaRootService.js';
import type { LessonFolderService } from './lessonFolderService.js';
import type { CourseScanInput, CourseScanResult } from './lessonTypes.js';
import { findMissingLessons, planScan } from './lessonScanPlan.js';
import { insertionIndex } from './lessonOrder.js';

export class LessonScanService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly media: MediaRootService,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
    private readonly folders: LessonFolderService,
  ) {}

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
  scanCourseFolder(actor: User, courseId: number, input: CourseScanInput = {}): CourseScanResult {
    const dryRun = input.dryRun === true;
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const folder = this.folders.courseFolderInfo(courseId);
    if (!folder) throw AppError.badRequest('该课程还没有绑定视频文件夹，请先选择文件夹并绑定');
    if (!folder.available) throw AppError.badRequest(`媒体目录不可访问：${folder.rootName}，请检查挂载或权限`);

    const { folders } = this.media.scan(folder.rootId, folder.path);
    const existing = this.lessons.listByRootPrefix(folder.rootId, folder.path);
    const plan = planScan({
      folders,
      folderPath: folder.path,
      courseId,
      chapterMode: input.chapterMode ?? 'first',
      existing,
      ...(input.onDuplicate === undefined ? {} : { onDuplicate: input.onDuplicate }),
    });

    const missing = findMissingLessons(existing, courseId, plan.onDisk, (videoPath) => {
      try {
        const { abs } = this.media.resolve(folder.rootId, videoPath);
        return fs.existsSync(abs);
      } catch {
        /* 解析失败（目录被移除等）也按缺失处理 */
        return false;
      }
    });

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
        added: plan.planned.length,
        assigned: plan.assigned,
        updated: plan.updated,
        skipped: plan.skipped,
        missing,
        removed: 0,
        total: this.lessons.countByCourse(courseId) + plan.planned.length + plan.assigned - wouldRemove,
        newLessonIds: [],
      };
    }

    if (plan.steal.length > 0) this.lessons.batchAssign(plan.steal, courseId);
    for (const item of plan.sync) this.lessons.markFromFolder(item.id, item.chapter);

    let removed = 0;
    if (input.removeMissing === true) {
      removed = this.lessons.deleteMany(removable.map((m) => m.id));
    }

    const newLessonIds = this.createScannedLessons(courseId, folder.rootId, plan.planned);
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
        added: plan.planned.length,
        assigned: plan.assigned,
        updated: plan.updated,
        skipped: plan.skipped,
        removed,
        missing: missing.length,
      },
    });

    return {
      dryRun: false,
      courseId,
      folder: this.folders.courseFolderInfo(courseId) ?? folder,
      onDisk: onDiskCount,
      folders: folders.length,
      added: newLessonIds.length,
      assigned: plan.assigned,
      updated: plan.updated,
      skipped: plan.skipped,
      missing,
      removed,
      total: this.lessons.countByCourse(courseId),
      newLessonIds,
    };
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
      layout.splice(insertionIndex(layout, item.chapter), 0, { id, chapter: item.chapter });
    }
    this.lessons.reorder(layout.map((l) => l.id));
    return createdIds;
  }
}
