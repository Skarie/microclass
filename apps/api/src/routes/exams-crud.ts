/**
 * 考试主体路由：课程下的考试列表、我的考试成绩、考试 CRUD。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、请求体 schema、返回结构全部保持不变。
 * 组卷在 `exams-paper` / `exams-compose`，题池在 `exams-pool`，作答与成绩在 `exams-attempts`。
 *
 * P0 阶段 2（批次 1）：考试读取走 AsyncDb，服务方法返回 Promise。
 * 注意：`return service.x()` 交给 Fastify 会自动 await，但「先取字段再拼响应」必须显式 await，
 * 否则响应体变成 `{}` / `Promise`（tsc 抓不到，见 docs/pg-migration-progress.md §3）。
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
    return { ok: true, id: await deps.examService.create(user, req.body as ExamDto) };
  });

  app.get('/exams/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    const exam = await deps.examService.findById(examIdOf(req));
    if (exam.status !== 'published' && user.role === 'student') throw AppError.notFound('考试未发布');
    return { exam };
  });

  app.put('/exams/:id', { schema: { body: examBodySchema } }, async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    await deps.examService.update(user, examIdOf(req), req.body as ExamDto);
    return { ok: true };
  });

  app.delete('/exams/:id', async (req, reply) => {
    const user = requireTeacherOrAdmin(req, reply);
    await deps.examService.remove(user, examIdOf(req));
    return { ok: true };
  });
}
