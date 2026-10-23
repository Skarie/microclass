/**
 * 作答与成绩路由：取卷、交卷、我的成绩、成绩单与成绩单 CSV。
 *
 * 从 `routes/exams.ts` 拆出；路径、方法、`submitSchema` 校验与返回结构保持不变。
 * 判分口径在 `services/exam-grade`（纯函数），CSV 生成在 `services/exam-report`。
 */
import type { FastifyInstance } from 'fastify';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import { csvHeaders, toCsv } from '../utils/csv.js';
import type { Deps } from '../app.js';
import { examIdOf, submitSchema } from './exams-shared.js';

export async function registerExamAttemptRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 取卷作答 */
  app.get('/exams/:id/take', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.take(user, examIdOf(req));
  });

  /** 交卷 */
  app.post('/exams/:id/submit', { schema: { body: submitSchema } }, async (req, reply) => {
    const user = requireUser(req, reply);
    const body = req.body as { answers: { qid: number; answer?: string }[]; startedAt?: number };
    const result = deps.examService.submit(
      user,
      examIdOf(req),
      body.answers.map((a) => ({ qid: Number(a.qid), answer: String(a.answer ?? '') })),
      body.startedAt,
    );
    return { ok: true, ...result };
  });

  /** 我的成绩 */
  app.get('/exams/:id/result', async (req, reply) => {
    const user = requireUser(req, reply);
    return deps.examService.myResult(user, examIdOf(req));
  });

  /** 成绩单（管理端） */
  app.get('/exams/:id/scores', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    return deps.examService.scoreSheet(examIdOf(req));
  });

  /** 成绩单 CSV */
  app.get('/exams/:id/scores.csv', async (req, reply) => {
    requireTeacherOrAdmin(req, reply);
    const { filename, rows } = deps.examService.scoreSheetCsv(examIdOf(req));
    return reply.headers(csvHeaders(filename)).send(toCsv(rows));
  });
}
