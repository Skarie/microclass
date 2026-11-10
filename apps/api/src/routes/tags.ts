/**
 * 自由标签路由（迁移 0030）
 *
 *   GET    /tags                          标签列表（`?search=` 按名字/备注搜，带题目数）
 *   POST   /tags                          新建（201，返回 { ok, id }）
 *   PUT    /tags/:id                      改名 / 改备注
 *   DELETE /tags/:id                      删标签（只解除题目标记，不删题目）
 *   GET    /questions/:id/tags            这道题的标签（题目编辑弹窗回显）
 *   POST   /questions/:id/tags            { tagIds } 覆盖式设置该题标签
 *   POST   /questions/tags                { questionIds, tagIds, mode } 批量打标（add/remove/replace）
 *
 * 读接口登录即可，写接口教师 / 管理员（guards 的 TEACHER_ROUTES + requireTeacherOrAdmin 双层）。
 * 标签筛选（`tagIds` / `tagMode`）在题目列表与组卷题池的查询参数里，见 bankQuery / examPoolQuery。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { TagRepository } from '../db/repositories/tagRepository.js';
import { TagService, TAG_NOTE_MAX } from '../services/tagService.js';

const writeBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    note: { type: 'string', maxLength: TAG_NOTE_MAX },
  },
  additionalProperties: false,
} as const;

const setQuestionTagsSchema = {
  type: 'object',
  required: ['tagIds'],
  properties: { tagIds: { type: 'array', items: { type: 'integer' } } },
  additionalProperties: false,
} as const;

const batchTagsSchema = {
  type: 'object',
  required: ['questionIds', 'tagIds'],
  properties: {
    questionIds: { type: 'array', items: { type: 'integer' }, minItems: 1 },
    tagIds: { type: 'array', items: { type: 'integer' } },
    mode: { type: 'string', enum: ['add', 'remove', 'replace'] },
  },
  additionalProperties: false,
} as const;

function tagIdOf(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('标签 id 非法');
  return id;
}

function questionIdOf(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('题目 id 非法');
  return id;
}

export async function registerTagRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new TagService(new TagRepository(deps.db), deps.audit);

  app.get('/tags', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { search?: unknown };
    return { tags: service.list(q.search) };
  });

  app.post('/tags', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const id = service.create(actor, req.body as { name?: unknown; note?: unknown });
    return reply.code(201).send({ ok: true, id });
  });

  app.put('/tags/:id', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.update(actor, tagIdOf(req), req.body as { name?: unknown; note?: unknown });
    return { ok: true };
  });

  app.delete('/tags/:id', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.remove(actor, tagIdOf(req));
    return { ok: true };
  });

  app.get('/questions/:id/tags', async (req, reply) => {
    requireUser(req, reply);
    return { tags: service.ofQuestion(questionIdOf(req)) };
  });

  app.post('/questions/:id/tags', { schema: { body: setQuestionTagsSchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const body = req.body as { tagIds: unknown };
    return { ok: true, ...service.setQuestionTags(actor, questionIdOf(req), body.tagIds) };
  });

  /** 批量打标：路由 /questions/tags 与 /questions/:id/tags 方法不同（POST vs GET），不会互相遮挡 */
  app.post('/questions/tags', { schema: { body: batchTagsSchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const body = req.body as { questionIds: unknown; tagIds: unknown; mode?: unknown };
    return { ok: true, ...service.batch(actor, body) };
  });
}
