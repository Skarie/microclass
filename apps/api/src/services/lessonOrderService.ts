/** 课时归属与顺序：批量改绑课程/章节、课程内拖拽排序，含审计。 */
import { AppError, type User } from '@microclass/shared';
import type { LessonRepository } from '../db/repositories/lessonRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import { normalizeAssignIds, validateReorderIds } from './lessonOrder.js';

export interface BatchAssignInput {
  lessonIds: number[];
  courseId: number | null;
  groupName?: string;
}

export interface BatchAssignResult {
  updated: number;
  courseId: number | null;
  groupName: string | null;
}

export class LessonOrderService {
  constructor(
    private readonly lessons: LessonRepository,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * 批量改绑归属：把选中的课时一次性挂到目标课程（courseId=null 表示移出课程回到「未归类」），
   * 可选统一章节名。常用于「先把视频全导进来，再按文件夹整理成课程」的场景。
   */
  batchAssign(actor: User, input: BatchAssignInput): BatchAssignResult {
    const ids = normalizeAssignIds(input.lessonIds);
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

  /** 批量保存课程内的课时顺序（拖拽排序） */
  reorderLessons(actor: User, courseId: number, ids: number[]): { updated: number } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const current = this.lessons.listByCourse(courseId).map((l) => l.id);
    if (current.length === 0) throw AppError.badRequest('该课程还没有课时');
    const unique = validateReorderIds(ids, current);
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
}
