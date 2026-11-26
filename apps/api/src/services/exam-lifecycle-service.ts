/**
 * 考试生命周期：课程下的考试列表、存在性校验、创建 / 更新 / 删除与入参归一化。
 *
 * 本模块只碰 `exams` / `courses` / `audit` 三个仓储；组卷、作答、成绩在其它模块。
 * 归一化口径（默认 60 分钟 / 60 分、时间戳只收非负整数、次数 0~99）与重构前逐字一致。
 */
import { AppError, type Exam, type User } from '@microclass/shared';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { CourseRepository } from '../db/repositories/courseRepository.js';
import type { ExamAttempt, ExamRepository, ExamWithStats } from '../db/repositories/examRepository.js';
import type { ExamPaperCache } from './exam-paper-cache.js';

export interface ExamDto {
  courseId: number;
  title: string;
  description?: string;
  durationMinutes?: number;
  passScore?: number;
  status?: Exam['status'];
  /** 考试设置（对标学习通）：时间窗口 / 作答次数 / 题目乱序 / 交卷后公布答案 */
  startAt?: number;
  endAt?: number;
  attemptLimit?: number;
  shuffleQuestions?: boolean;
  showAnswers?: boolean;
}

export class ExamLifecycleService {
  constructor(
    private readonly exams: ExamRepository,
    private readonly courses: CourseRepository,
    private readonly audit: AuditRepository,
    private readonly paperCache: ExamPaperCache,
  ) {}

  /** 课程下的考试列表；学生只看已发布，且带自己的最近成绩 */
  async listForCourse(
    viewer: User,
    courseId: number,
  ): Promise<{ course: { id: number; name: string }; exams: unknown[] }> {
    const course = await this.courses.findById(courseId);
    if (!course) throw AppError.notFound('课程不存在');
    const isManager = viewer.role === 'admin' || viewer.role === 'teacher';
    const exams = (await this.exams.listByCourseWithStats(courseId, isManager ? null : viewer.id))
      .filter((e) => isManager || e.status === 'published')
      .map((e: ExamWithStats & { my: ExamAttempt | null }) => ({
        ...e,
        qcount: e.question_count,
        my: e.my
          ? {
              score: e.my.score,
              total: e.my.total,
              passed: e.my.passed,
              used_seconds: e.my.used_seconds,
              created_at: e.my.created_at,
            }
          : null,
      }));
    return { course: { id: course.id, name: course.name }, exams };
  }

  async findById(examId: number): Promise<Exam> {
    const exam = await this.exams.findById(examId);
    if (!exam) throw AppError.notFound('考试不存在');
    return exam;
  }

  async create(actor: User, input: ExamDto): Promise<number> {
    const prepared = await this.prepare(input);
    const id = await this.exams.create(prepared);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.create',
      targetType: 'exam',
      targetId: id,
      detail: { courseId: prepared.courseId, title: prepared.title },
    });
    return id;
  }

  async update(actor: User, examId: number, input: ExamDto): Promise<void> {
    await this.findById(examId);
    const prepared = await this.prepare(input);
    await this.exams.update(examId, prepared);
    // 卷面缓存：**写成功之后**再失效（写失败时不能把仍在用的缓存清掉）
    this.paperCache.clearPaper(examId);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.update',
      targetType: 'exam',
      targetId: examId,
    });
  }

  async remove(actor: User, examId: number): Promise<void> {
    const exam = await this.findById(examId);
    await this.exams.delete(examId);
    this.paperCache.clearPaper(examId);
    await this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'exam.delete',
      targetType: 'exam',
      targetId: examId,
      detail: { title: exam.title },
    });
  }

  private async prepare(input: ExamDto): Promise<{
    courseId: number;
    title: string;
    description: string;
    durationMinutes: number;
    passScore: number;
    status: Exam['status'];
    /** 考试设置（对标学习通）：只在显式传入时覆盖，未传的项保持原值 */
    startAt?: number;
    endAt?: number;
    attemptLimit?: number;
    shuffleQuestions?: boolean;
    showAnswers?: boolean;
  }> {
    const courseId = Number(input.courseId);
    if (!Number.isInteger(courseId) || !(await this.courses.findById(courseId))) {
      throw AppError.badRequest('课程不存在');
    }
    const title = String(input.title ?? '').trim();
    if (!title) throw AppError.badRequest('考试标题不能为空');
    const rawDuration = Number(input.durationMinutes);
    const durationMinutes = Number.isFinite(rawDuration) && rawDuration >= 1 ? Math.floor(rawDuration) : 60;
    const rawPass = Number(input.passScore);
    const passScore = Number.isFinite(rawPass) && rawPass >= 0 && rawPass <= 100 ? Math.round(rawPass) : 60;
    /** 时间戳：只接受非负整数（0 = 不限） */
    const stamp = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const startAt = stamp(input.startAt);
    const endAt = stamp(input.endAt);
    if (startAt !== undefined && endAt !== undefined && startAt > 0 && endAt > 0 && endAt <= startAt) {
      throw AppError.badRequest('结束时间必须晚于开始时间');
    }
    const limit =
      input.attemptLimit === undefined
        ? undefined
        : Math.min(99, Math.max(0, Math.floor(Number(input.attemptLimit) || 0)));
    return {
      courseId,
      title,
      description: String(input.description ?? ''),
      durationMinutes,
      passScore,
      status: input.status === 'published' ? 'published' : 'draft',
      ...(startAt === undefined ? {} : { startAt }),
      ...(endAt === undefined ? {} : { endAt }),
      ...(limit === undefined ? {} : { attemptLimit: limit }),
      ...(input.shuffleQuestions === undefined ? {} : { shuffleQuestions: input.shuffleQuestions === true }),
      ...(input.showAnswers === undefined ? {} : { showAnswers: input.showAnswers !== false }),
    };
  }
}
