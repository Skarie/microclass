/**
 * 站内公告路由（迁移 0028）
 *
 *   GET    /announcements                 公开列表（登录可读，只出已发布，置顶优先）
 *   GET    /admin/announcements           管理端全部（含草稿）+ 分页
 *   POST   /admin/announcements           新建（201）
 *   PUT    /admin/announcements/:id       部分更新
 *   DELETE /admin/announcements/:id       删除
 *
 * 写接口仅管理员（guards 的 ADMIN_ROUTES + requireAdmin 双层），写操作落审计。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { AnnouncementRepository } from '../db/repositories/announcementRepository.js';
import { AnnouncementService, type AnnouncementInput } from '../services/announcementService.js';

const writeBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    level: { type: 'string', enum: ['info', 'warning', 'danger'] },
    pinned: { type: 'boolean' },
    published: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

function idOf(req: FastifyRequest): number {
  const id = Number((req.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('公告 ID 非法');
  return id;
}

export async function registerAnnouncementRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new AnnouncementService(new AnnouncementRepository(deps.db), deps.audit);

  app.get('/announcements', async (req, reply) => {
    requireUser(req, reply);
    const q = req.query as { limit?: unknown };
    return { announcements: service.listPublic(q.limit) };
  });

  app.get('/admin/announcements', async (req, reply) => {
    requireAdmin(req, reply);
    const q = req.query as { limit?: unknown; offset?: unknown };
    return service.listAdmin(q.limit, q.offset);
  });

  app.post('/admin/announcements', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireAdmin(req, reply);
    const id = service.create(actor, req.body as AnnouncementInput);
    return reply.code(201).send({ ok: true, id });
  });

  app.put('/admin/announcements/:id', { schema: { body: writeBodySchema } }, async (req, reply) => {
    const actor = requireAdmin(req, reply);
    service.update(actor, idOf(req), req.body as AnnouncementInput);
    return { ok: true };
  });

  app.delete('/admin/announcements/:id', async (req, reply) => {
    const actor = requireAdmin(req, reply);
    service.remove(actor, idOf(req));
    return { ok: true };
  });
}
