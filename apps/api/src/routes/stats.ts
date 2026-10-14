/**
 * 学习统计路由（管理端）与课时笔记路由（学生本人）。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { csvHeaders } from '../utils/csv.js';
import type { Deps } from '../app.js';

export async function registerStatsRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 课时学习统计 */
  app.get('/stats/lessons/:id', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.statsService.lessonStats(Number((req.params as { id: string }).id));
  });

  /** 课时学习统计 CSV */
  app.get('/stats/lessons/:id.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.statsService.lessonStatsCsv(Number((req.params as { id: string }).id));
    return reply.headers(csvHeaders(filename)).send(body);
  });

  /** 课程学习统计 */
  app.get('/stats/courses/:id', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.statsService.courseStats(Number((req.params as { id: string }).id));
  });

  /** 课程学习统计 CSV */
  app.get('/stats/courses/:id.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, body } = deps.statsService.courseStatsCsv(Number((req.params as { id: string }).id));
    return reply.headers(csvHeaders(filename)).send(body);
  });
}

export async function registerNoteRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/lessons/:id/notes', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.noteService.list(user, Number((req.params as { id: string }).id));
  });

  app.post('/lessons/:id/notes', async (req, reply) => {
    const user = requireUser(req, reply);
    const lessonId = Number((req.params as { id: string }).id);
    const body = req.body as { pos?: number; text?: string };
    if (!body || typeof body.text !== 'string') throw AppError.badRequest('缺少笔记内容');
    return {
      ok: true,
      id: deps.noteService.create(user, lessonId, { pos: Number(body.pos ?? 0), text: body.text }),
    };
  });

  app.delete('/notes/:id', async (req, reply) => {
    const user = requireUser(req, reply);
    deps.noteService.remove(user, Number((req.params as { id: string }).id));
    return { ok: true };
  });
}
