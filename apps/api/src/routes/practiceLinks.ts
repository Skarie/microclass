/**
 * 实践关联路由（迁移 0025）：
 *   GET    /practice-links?bankId=      某题库的关联列表（登录可读）
 *   POST   /practice-links              新建关联（教师/管理员）
 *   PATCH  /practice-links/:id          覆盖式改课时（教师/管理员）
 *   DELETE /practice-links/:id          删除关联（教师/管理员）
 *   GET    /lessons/:id/practice        课时关联的练习内容（登录可读，学生可用）
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { PracticeLinkRepository } from '../db/repositories/practiceLinkQueries.js';
import { PracticeLinkService, type PracticeLinkInput } from '../services/practiceLinkService.js';

const targetTypeSchema = { type: 'string', enum: ['bank', 'chapter', 'section', 'question'] } as const;

const createBodySchema = {
  type: 'object',
  required: ['targetType', 'bankId', 'lessonIds'],
  properties: {
    targetType: targetTypeSchema,
    bankId: { type: 'integer' },
    questionId: { type: 'integer' },
    /** 上限 120 由服务端 trim 后截断 */
    chapter: { type: 'string' },
    section: { type: 'string' },
    lessonIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'integer' } },
  },
  additionalProperties: false,
} as const;

const updateBodySchema = {
  type: 'object',
  required: ['lessonIds'],
  properties: {
    lessonIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'integer' } },
  },
  additionalProperties: false,
} as const;

function positiveId(raw: unknown, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest(`${label} 非法`);
  return id;
}

function bankIdOfQuery(req: FastifyRequest): number {
  return positiveId((req.query as { bankId?: string }).bankId, 'bankId 参数');
}

function idOf(req: FastifyRequest): number {
  return positiveId((req.params as { id: string }).id, '关联 id');
}

export async function registerPracticeLinkRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new PracticeLinkService(
    new PracticeLinkRepository(deps.db),
    deps.banks,
    deps.questions,
    deps.lessons,
    deps.audit,
  );

  app.get('/practice-links', async (req, reply) => {
    requireUser(req, reply);
    return service.list(bankIdOfQuery(req));
  });

  app.post('/practice-links', { schema: { body: createBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const link = service.create(actor, req.body as PracticeLinkInput);
    return reply.code(201).send({ link });
  });

  app.patch('/practice-links/:id', { schema: { body: updateBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const body = req.body as { lessonIds: number[] };
    return { link: service.update(actor, idOf(req), body.lessonIds) };
  });

  app.delete('/practice-links/:id', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.remove(actor, idOf(req));
    return { ok: true };
  });

  /** 学生端：某课时关联的练习内容（整库 / 章节 / 小节 / 单题汇总） */
  app.get('/lessons/:id/practice', async (req, reply) => {
    requireUser(req, reply);
    return service.lessonPractice(positiveId((req.params as { id: string }).id, '课时 id'));
  });
}
