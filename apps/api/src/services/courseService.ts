/**
 * 课程服务：列表聚合、增删改、封面、收藏、分类。
 *
 * lessons/courses 域迁到 `AsyncDb` 后，本服务全部改为 async（调用点补 await）。
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

  async list(viewer: User): Promise<CourseListResult> {
    const includeDrafts = viewer.role === 'admin' || viewer.role === 'teacher';
    return {
      courses: await this.courses.aggregate({ forUserId: viewer.id, includeDrafts }),
      categories: await this.courses.listCategories(),
      orphans: await this.courses.orphanAggregate(viewer.id),
    };
  }

  /** 课程详情（课时列表通过 LessonService 提供） */
  async detail(viewer: User, courseId: number): Promise<{ course: CourseAggregate }> {
    const course = await this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    if (course.published !== 1 && viewer.role !== 'admin' && viewer.role !== 'teacher') {
      throw AppError.notFound('课程未发布');
    }
    const agg = (await this.courses.aggregate({ forUserId: viewer.id, includeDrafts: true })).find(
      (c) => c.id === courseId,
    );
    return { course: agg ?? { ...course, category_name: '', total: 0, finished: 0, quiz: 0, fav: false } };
  }

  async create(
    actor: User,
    input: { name: string; description?: string; sort?: number; categoryId?: number | null; published?: boolean },
  ): Promise<number> {
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('课程名称不能为空');
    if (input.categoryId) await this.assertCategory(input.categoryId);
    const id = await this.courses.create({ ...input, name });
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.create',
      targetType: 'course',
      targetId: id,
      detail: { name },
    });
    return id;
  }

  async update(
    actor: User,
    id: number,
    input: { name: string; description?: string; sort?: number; categoryId?: number | null; published?: boolean },
  ): Promise<void> {
    const course = await this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    const name = (input.name ?? '').trim();
    if (!name) throw AppError.badRequest('课程名称不能为空');
    if (input.categoryId) await this.assertCategory(input.categoryId);
    await this.courses.update(id, { ...input, name });
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.update',
      targetType: 'course',
      targetId: id,
    });
  }

  async remove(actor: User, id: number): Promise<void> {
    const course = await this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    await this.courses.delete(id);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.delete',
      targetType: 'course',
      targetId: id,
      detail: { name: course.name },
    });
  }

  async setCover(actor: User, id: number, relPath: string): Promise<void> {
    const course = await this.courses.findById(id);
    if (!course) throw AppError.notFound('课程不存在');
    await this.courses.setCover(id, relPath);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'course.cover',
      targetType: 'course',
      targetId: id,
    });
  }

  async toggleFavorite(viewer: User, courseId: number): Promise<boolean> {
    const course = await this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    return this.courses.toggleFavorite(viewer.id, courseId);
  }

  async createCategory(actor: User, name: string): Promise<number> {
    const clean = (name ?? '').trim();
    if (!clean) throw AppError.badRequest('分类名称不能为空');
    if (await this.courses.findCategoryByName(clean)) throw AppError.conflict('分类已存在');
    const id = await this.courses.createCategory(clean);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'category.create',
      targetType: 'category',
      targetId: id,
      detail: { name: clean },
    });
    return id;
  }

  async deleteCategory(actor: User, id: number): Promise<void> {
    await this.courses.deleteCategory(id);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'category.delete',
      targetType: 'category',
      targetId: id,
    });
  }

  private async assertCategory(id: number): Promise<void> {
    const found = (await this.courses.listCategories()).some((c) => c.id === id);
    if (!found) throw AppError.badRequest('分类不存在');
  }
}
