/**
 * 题组 / 变式关联路由（迁移 0029）
 *
 *   GET    /question-groups                         列表（`?search=` 按标题/备注搜）
 *   POST   /question-groups                         新建（201，返回 { ok, id }）
 *   GET    /question-groups/:id                     组信息 + 组内题目（母题在前）
 *   PUT    /question-groups/:id                     改标题 / 备注（部分更新）
 *   DELETE /question-groups/:id                     删组（组内关联一并删除，不动题目本身）
 *   POST   /question-groups/:id/items               批量加入（已存在则更新角色）
 *   DELETE /question-groups/:id/items/:questionId   把某题移出组
 *   GET    /questions/:id/groups                    这道题所属的题组（题目详情用）
 *
 * 读接口登录即可，写接口教师 / 管理员（guards 的 TEACHER_ROUTES + requireTeacherOrAdmin 双层）。
 * 校验在 questionGroupService，这里只做「取 id、解析 body、调服务、套返回结构」。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireTeacherOrAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { QuestionGroupRepository } from '../db/repositories/questionGroupRepository.js';
import { QuestionGroupService, GROUP_NOTE_MAX } from '../services/questionGroupService.js';

const writeBodySchema = {
  type: 'object',
  properties: {
    // schema 只兜「类型 + 明显超长」，trim 后的 1..100 校验在服务层（错误文案一致）
    title: { type: 'string', minLength: 1, maxLength: 200 },
    note: { type: 'string', maxLength: GROUP_NOTE_MAX },
  },
  additionalProperties: false,
} as const;

const itemsBodySchema = {
  type: 'object',
  required: ['questionIds', 'role'],
  properties: {
    questionIds: { type: 'array', items: { type: 'integer' }, minItems: 1 },
    role: { type: 'string', enum: ['stem', 'variant'] },
  },
  additionalProperties: false,
} as const;

function groupIdOf(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('题组 id 非法');
  return id;
}

function questionIdOf(req: FastifyRequest): number {
  const id = Number((req.params as { questionId: string }).questionId);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('题目 id 非法');
  return id;
}

export async function registerQuestionGroupRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new QuestionGroupService(new QuestionGroupRepository(deps.db), deps.audit);

  app.get('/question-groups', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { search?: unknown };
    return { groups: service.list(q.search) };
  });

  app.post('/question-groups', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const id = service.create(actor, req.body as { title?: unknown; note?: unknown });
    return reply.code(201).send({ ok: true, id });
  });

  app.get('/question-groups/:id', async (req, reply) => {
    requireUser(req, reply);
    return service.detail(groupIdOf(req));
  });

  app.put('/question-groups/:id', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.update(actor, groupIdOf(req), req.body as { title?: unknown; note?: unknown });
    return { ok: true };
  });

  app.delete('/question-groups/:id', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.remove(actor, groupIdOf(req));
    return { ok: true };
  });

  app.post('/question-groups/:id/items', { schema: { body: itemsBodySchema } }, async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    const body = req.body as { questionIds: unknown; role: unknown };
    return { ok: true, ...service.addItems(actor, groupIdOf(req), body.questionIds, body.role) };
  });

  app.delete('/question-groups/:id/items/:questionId', async (req, reply) => {
    const actor = requireTeacherOrAdmin(req, reply);
    service.removeItem(actor, groupIdOf(req), questionIdOf(req));
    return { ok: true };
  });

  app.get('/questions/:id/groups', async (req, reply) => {
    requireUser(req, reply);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('题目 id 非法');
    return { groups: service.groupsOfQuestion(id) };
  });
}
