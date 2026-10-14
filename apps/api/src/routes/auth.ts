/**
 * 认证路由：登录、注册、登出、当前用户、改密、站点元信息。
 */
import type { FastifyInstance } from 'fastify';
import { SessionSigner } from '../security/session.js';
import { requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';

export async function registerAuthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const cookieOpts = SessionSigner.cookieOptions();

  app.get('/meta', async (req) => ({
    siteName: deps.config.siteName,
    user: req.authUser,
    allowRegister: deps.settings.getBool('allow_register', deps.config.allowRegister),
  }));

  app.get('/me', async (req, reply) => {
    const user = requireUser(req, reply);
    return { user };
  });

  app.post(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { username: string; password: string };
      const { user, token } = deps.auth.login({
        username: body.username,
        password: body.password,
        ip: req.ip,
        requestId: req.requestId,
      });
      reply.setCookie(SessionSigner.cookieName(), token, cookieOpts);
      return { user };
    },
  );

  app.post(
    '/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 2, maxLength: 32 },
            password: { type: 'string', minLength: 6, maxLength: 128 },
            displayName: { type: 'string', maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { username: string; password: string; displayName?: string };
      const { user, token } = deps.auth.register(body);
      reply.setCookie(SessionSigner.cookieName(), token, cookieOpts);
      return { user };
    },
  );

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SessionSigner.cookieName(), { path: '/' });
    return { ok: true };
  });

  app.put(
    '/me/password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['oldPassword', 'newPassword'],
          properties: {
            oldPassword: { type: 'string', minLength: 1 },
            newPassword: { type: 'string', minLength: 6, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req, reply);
      const body = req.body as { oldPassword: string; newPassword: string };
      deps.auth.changePassword({ userId: user.id, oldPassword: body.oldPassword, newPassword: body.newPassword });
      return { ok: true };
    },
  );
}
