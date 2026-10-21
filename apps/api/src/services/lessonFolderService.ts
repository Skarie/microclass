/** 课程文件夹领域：绑定/展示，以及按文件夹批量导入课时。 */
import fs from 'node:fs';
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import { folderSelfName, naturalSort, normalizeBoundFolderPath, trimFolderPath } from './lessonInput.js';
import type { MediaRootService } from './mediaRootService.js';
import type { CourseFolderInfo } from './lessonTypes.js';

export interface ImportFolderInput {
  rootId: string;
  path?: string;
  courseId?: number | null;
  onDuplicate?: 'skip' | 'assign';
}

export interface ImportFolderResult {
  added: number;
  skipped: number;
  assigned: number;
  folders: number;
}

export class LessonFolderService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly media: MediaRootService,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
  ) {}

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

    const rel = normalizeBoundFolderPath(input.path);
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
   * 按文件夹批量导入：子文件夹 → 章节(group_name)，文件 → 课时。
   *
   * 章节命名规则（符合「我选中的文件夹就是这一章」的直觉）：
   *   - 扫描的是某个子文件夹时，该文件夹**自身**的直接视频 → 章节名取该文件夹名；
   *   - 更深的子文件夹 → 章节名取子文件夹名。
   *
   * 重复视频的处理（`onDuplicate`）：
   *   - `skip`（默认）：已存在同路径课时就跳过，计数进 `skipped`；
   *   - `assign`：把这些**已存在**的课时收编到目标课程（并统一章节），计数进 `assigned`。
   */
  importFromFolder(actor: User, input: ImportFolderInput): ImportFolderResult {
    const rel = trimFolderPath(input.path);
    // 选中的文件夹名（作为其直接下属视频的章节名）
    const selfName = folderSelfName(rel);
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
}
