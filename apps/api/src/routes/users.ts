/**
 * 用户管理（管理员）：学生/教师账号、重置密码、审计日志。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireAdmin, requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';

export async function registerUserRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/users', async (req, reply) => {
    requireAdmin(req, reply);
    const q = req.query as { role?: string };
    const rows = q.role === 'all' ? deps.users.listAll() : deps.users.listStudents();
    return { users: rows };
  });

  app.post(
    '/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 2, maxLength: 32 },
            password: { type: 'string', minLength: 6, maxLength: 128 },
            role: { type: 'string', enum: ['student', 'teacher'] },
            displayName: { type: 'string', maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const actor = requireAdmin(req, reply);
      const body = req.body as {
        username: string;
        password: string;
        role?: 'student' | 'teacher';
        displayName?: string;
      };
      const id = deps.auth.createUserByAdmin(body, actor);
      return { ok: true, id };
    },
  );

  app.put(
    '/users/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            username: { type: 'string', minLength: 2, maxLength: 32 },
            displayName: { type: 'string', maxLength: 64 },
            password: { type: 'string', minLength: 6, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const actor = requireAdmin(req, reply);
      const id = Number((req.params as { id: string }).id);
      const body = req.body as { username?: string; displayName?: string; password?: string };
      const existing = deps.users.findById(id);
      if (!existing) throw AppError.notFound('用户不存在');
      if (body.password) deps.auth.resetPasswordByAdmin(id, body.password, actor);
      if (body.username !== undefined || body.displayName !== undefined) {
        deps.users.updateProfile(
          id,
          body.username?.trim().toLowerCase() || existing.username,
          body.displayName ?? existing.display_name,
        );
        deps.audit.write({
          actorId: actor.id,
          actorName: actor.username,
          action: 'user.update_profile',
          targetType: 'user',
          targetId: id,
        });
      }
      return { ok: true };
    },
  );

  app.delete('/users/:id', async (req, reply) => {
    const actor = requireAdmin(req, reply);
    const id = Number((req.params as { id: string }).id);
    const changes = deps.users.deleteStudent(id);
    if (changes === 0) throw AppError.notFound('学生不存在');
    deps.db.run('DELETE FROM lesson_progress WHERE user_id = ?', [id]);
    deps.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
    });
    return { ok: true };
  });

  app.get('/audit-logs', async (req, reply) => {
    requireAdmin(req, reply);
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(((req.query as { limit?: string }).limit ?? '100').toString(), 10) || 100),
    );
    return { logs: deps.audit.recent(limit) };
  });

  app.get('/settings', async (req, reply) => {
    requireAdmin(req, reply);
    const s = deps.settings.all();
    // 仅暴露可公开的管理项，密钥类不返回
    return { settings: { allow_register: s.allow_register ?? '1' } };
  });

  app.put('/settings', async (req, reply) => {
    const actor = requireAdmin(req, reply);
    const body = req.body as { allowRegister?: boolean };
    if (body.allowRegister !== undefined) {
      deps.settings.setBool('allow_register', body.allowRegister);
      deps.audit.write({
        actorId: actor.id,
        actorName: actor.username,
        action: 'settings.update',
        targetType: 'settings',
        targetId: 'allow_register',
        detail: { value: body.allowRegister },
      });
    }
    return { ok: true, allowRegister: deps.settings.getBool('allow_register', true) };
  });

  app.get('/admin/me', async (req, reply) => {
    const user = requireUser(req, reply);
    return { user };
  });
}
