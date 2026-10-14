/**
 * 刷题路由：取题、提交判分、刷题记录、错题本。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import type { SubmitItem } from '../services/quizService.js';

export async function registerQuizRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  /** 取题（学生视角不含答案；教师/管理员含答案） */
  app.get('/lessons/:id/quiz', async (req, reply) => {
    const user = requireUser(req, reply);
    const lessonId = parseId((req.params as { id: string }).id, '课时 ID 非法');
    const q = req.query as { count?: string };
    const count = q.count === undefined ? undefined : Number.parseInt(q.count, 10);
    if (count !== undefined && Number.isNaN(count)) throw AppError.badRequest('count 参数非法');
    return deps.quizService.quiz(user, lessonId, count === undefined ? undefined : { count });
  });

  /** 提交判分 */
  app.post('/lessons/:id/quiz/submit', async (req, reply) => {
    const user = requireUser(req, reply);
    const lessonId = parseId((req.params as { id: string }).id, '课时 ID 非法');
    const body = req.body as { answers?: SubmitItem[]; clientId?: string };
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    if (answers.length === 0) throw AppError.badRequest('请先作答再提交');
    const result = deps.quizService.submit(user, lessonId, answers, body.clientId);
    return { ok: true, ...result };
  });

  /** 我的刷题记录 */
  app.get('/me/attempts', async (req, reply) => {
    const user = requireUser(req, reply);
    const q = req.query as { lesson?: string; limit?: string };
    const lessonId = q.lesson ? parseId(q.lesson, 'lesson 参数非法') : undefined;
    const limit = q.limit ? Number.parseInt(q.limit, 10) : undefined;
    return {
      attempts: deps.quizService.myAttempts(user, {
        ...(lessonId === undefined ? {} : { lessonId }),
        ...(limit === undefined || Number.isNaN(limit) ? {} : { limit }),
      }),
    };
  });

  /** 错题本 */
  app.get('/me/wrong-questions', async (req, reply) => {
    const user = requireUser(req, reply);
    const q = req.query as { lesson?: string; includeMastered?: string };
    return deps.quizService.wrongBook(user, {
      ...(q.lesson ? { lessonId: parseId(q.lesson, 'lesson 参数非法') } : {}),
      includeMastered: q.includeMastered === '1' || q.includeMastered === 'true',
    });
  });

  /** 标记/取消掌握 */
  app.post('/me/wrong-questions/:qid/master', async (req, reply) => {
    const user = requireUser(req, reply);
    const qid = parseId((req.params as { qid: string }).qid, '题目 ID 非法');
    const body = req.body as { mastered?: boolean } | undefined;
    deps.quizService.setMastered(user, qid, body?.mastered !== false);
    return { ok: true };
  });

  /** 从错题本移除 */
  app.delete('/me/wrong-questions/:qid', async (req, reply) => {
    const user = requireUser(req, reply);
    deps.quizService.removeFromWrongBook(user, parseId((req.params as { qid: string }).qid, '题目 ID 非法'));
    return { ok: true };
  });
}

function parseId(raw: string, message: string): number {
  const id = Number.parseInt(raw, 10);
  if (Number.isNaN(id)) throw AppError.badRequest(message);
  return id;
}
