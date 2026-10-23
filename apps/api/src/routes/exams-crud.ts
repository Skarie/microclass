/**
 * 考试主体路由：课程下的考试列表、我的考试成绩、考试 CRUD。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 组卷在 `exams-paper` / `exams-compose`，题池在 `exams-pool`，作答与成绩在 `exams-attempts`。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { ExamDto } from '../services/examService.js';
import { examBodySchema, examIdOf } from './exams-shared.js';

export async function registerExamCrudRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 课程下的考试列表（学生仅见已发布，并带本人成绩） */
  app.get('/courses/:id/exams', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.listForCourse(user, Number((req.params as { id: string }).id));
  });

  /** 我的全部考试成绩 */
  app.get('/me/exams', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.statsService.meOverview(user);
  });

  app.post('/exams', { schema: { body: examBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    return { ok: true, id: deps.examService.create(user, req.body as ExamDto) };
  });

  app.get('/exams/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    const exam = deps.examService.findById(examIdOf(req));
    if (exam.status !== 'published' && user.role === 'student') throw AppError.notFound('考试未发布');
    return { exam };
  });

  app.put('/exams/:id', { schema: { body: examBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.examService.update(user, examIdOf(req), req.body as ExamDto);
    return { ok: true };
  });

  app.delete('/exams/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    deps.examService.remove(user, examIdOf(req));
    return { ok: true };
  });
}
