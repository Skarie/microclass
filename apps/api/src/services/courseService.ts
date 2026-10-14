/**
 * 课程服务：列表聚合、增删改、封面、收藏、分类。
 */
import { AppError } from '@microclass/shared';
import type { CourseRepository, CourseAggregate } from '../db/repositories/courseRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { User } from '@microclass/shared';

export interface CourseListResult {
  courses: CourseAggregate[];
  categories: { id: number; name: string; sort: number }[];
  orphans: { total: number; finished: number; quiz: number };
}

export class CourseService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
  ) {}

  list(viewer: User): CourseListResult {
    const includeDrafts = viewer.role === 'admin' || viewer.role === 'teacher';
    return {
      courses: this.courses.aggregate({ forUserId: viewer.id, includeDrafts }),
      categories: this.courses.listCategories(),
      orphans: this.courses.orphanAggregate(viewer.id),
    };
  }

  /** 课程详情（课时列表通过 LessonService 提供） */
  detail(viewer: User, courseId: number): { course: CourseAggregate } {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    if (course.published !== 1 && viewer.role !== 'admin' && viewer.role !== 'teacher') {
      throw AppError.notFound('课程未发布');
    }
    const agg = this.courses.aggregate({ forUserId: viewer.id, includeDrafts: true }).find((c) => c.id === courseId);
    return { course: agg ?? { ...course, category_name: '', total: 0, finished: 0, quiz: 0, fav: false } };
  }

  create(
    actor: User,
    input: { name: string; description?: string; sort?: number; categoryId?: number | null; published?: boolean },
  ): number {
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('课程名称不能为空');
    if (input.categoryId) this.assertCategory(input.categoryId);
    const id = this.courses.create({ ...input, name });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.create',
      targetType: 'course',
      targetId: id,
      detail: { name },
    });
    return id;
  }

  update(
    actor: User,
    id: number,
    input: { name: string; description?: string; sort?: number; categoryId?: number | null; published?: boolean },
  ): void {
    const course = this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('课程名称不能为空');
    if (input.categoryId) this.assertCategory(input.categoryId);
    this.courses.update(id, { ...input, name });
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.update',
      targetType: 'course',
      targetId: id,
    });
  }

  remove(actor: User, id: number): void {
    const course = this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    this.courses.delete(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.delete',
      targetType: 'course',
      targetId: id,
      detail: { name: course.name },
    });
  }

  setCover(actor: User, id: number, relPath: string): void {
    const course = this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    this.courses.setCover(id, relPath);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.cover',
      targetType: 'course',
      targetId: id,
    });
  }

  toggleFavorite(viewer: User, courseId: number): boolean {
    const course = this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    return this.courses.toggleFavorite(viewer.id, courseId);
  }

  createCategory(actor: User, name: string): number {
    const clean = (name ?? '').trim();
    if (!clean) throw AppError.badRequest('分类名称不能为空');
    if (this.courses.findCategoryByName(clean)) throw AppError.conflict('分类已存在');
    const id = this.courses.createCategory(clean);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'category.create',
      targetType: 'category',
      targetId: id,
      detail: { name: clean },
    });
    return id;
  }

  deleteCategory(actor: User, id: number): void {
    this.courses.deleteCategory(id);
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'category.delete',
      targetType: 'category',
      targetId: id,
    });
  }

  private assertCategory(id: number): void {
    const found = this.courses.listCategories().some((c) => c.id === id);
    if (!found) throw AppError.badRequest('分类不存在');
  }
}
