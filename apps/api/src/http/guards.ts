/**
 * 鉴权与授权守卫。
 *
 * 分两层：
 *  1. `onRequest` 解析会话 Cookie，把用户挂到 `request.authUser`（不做判断）。
 *  2. `preValidation` 统一做「先鉴权授权、后参数校验」：
 *     - 默认 fail-closed：除公开白名单外，所有 /api/v1 接口都要求登录（新增接口默认受保护）；
 *     - 角色要求由下面的声明式表给出，命中即拦截。
 *     这样未登录的写请求返回 401 而不是「body 校验失败 400」，
 *     越权请求返回 403 而不是把校验细节暴露出去。
 *
 * 路由处理器里仍保留 `requireUser/requireTeacherOrAdmin` 等调用作为纵深防御。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';
import { SessionSigner } from '../security/session.js';
import type { UserRepository } from '../db/repositories/userRepository.js';
import type { Role, User } from '@microclass/shared';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: User | null;
  }
}

/** 无需登录即可访问的接口（路由模式，不含查询串） */
export const PUBLIC_ROUTES = new Set([
  '/api/v1/healthz',
  '/api/v1/readyz',
  '/api/v1/version',
  '/api/v1/openapi.json',
  '/api/v1/meta',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
  // 试卷打印页要加载 KaTeX 样式与字体：纯静态资源、不含数据，
  // 且 <link>/@font-face 请求不应被登录校验挡住（否则打印出来的公式没有字体）
  '/api/v1/paper-assets/katex.min.css',
  '/api/v1/paper-assets/fonts/:file',
]);

/** 仅管理员可访问（账号体系与系统设置） */
export const ADMIN_ROUTES = new Set([
  'GET /api/v1/users',
  'POST /api/v1/users',
  'PUT /api/v1/users/:id',
  'DELETE /api/v1/users/:id',
  'GET /api/v1/audit-logs',
  'GET /api/v1/settings',
  'PUT /api/v1/settings',
  'GET /api/v1/admin/me',
]);

/** 教师或管理员可访问（内容建设、题库、考试组卷、统计） */
export const TEACHER_ROUTES = new Set([
  'POST /api/v1/courses',
  'PUT /api/v1/courses/:id',
  'DELETE /api/v1/courses/:id',
  'POST /api/v1/courses/:id/cover',
  'GET /api/v1/courses/:id/manage',
  'GET /api/v1/courses/:id/knowledge.md',
  'GET /api/v1/courses/:id/knowledge.docx',
  'GET /api/v1/lessons/:id/knowledge.md',
  'GET /api/v1/lessons/:id/knowledge.docx',
  'PUT /api/v1/courses/:id/folder',
  'POST /api/v1/courses/:id/scan',
  'PUT /api/v1/courses/:id/lessons/order',
  'POST /api/v1/categories',
  'DELETE /api/v1/categories/:id',
  'POST /api/v1/lessons',
  'POST /api/v1/lessons/upload',
  'PUT /api/v1/lessons/:id',
  'DELETE /api/v1/lessons/:id',
  'POST /api/v1/lessons/batch-assign',
  'POST /api/v1/lessons/:id/knowledge',
  'POST /api/v1/lessons/:id/knowledge/file',
  'PUT /api/v1/knowledge/:id',
  'DELETE /api/v1/knowledge/:id',
  'GET /api/v1/media-roots',
  'POST /api/v1/media-roots',
  'DELETE /api/v1/media-roots/:id',
  'GET /api/v1/media-roots/:id/browse',
  'GET /api/v1/media-roots/:id/scan',
  'POST /api/v1/media-roots/:id/import',
  'GET /api/v1/fs/browse',
  'POST /api/v1/banks',
  'POST /api/v1/banks/bind-by-book',
  'POST /api/v1/banks/rebind-courses',
  'POST /api/v1/banks/fix-question-counts',
  'PUT /api/v1/banks/:id',
  'DELETE /api/v1/banks/:id',
  'GET /api/v1/banks/template.csv',
  'GET /api/v1/banks/:id/export.csv',
  'GET /api/v1/banks/template.md',
  'GET /api/v1/banks/:id/export.md',
  'GET /api/v1/banks/:id/export.docx',
  'POST /api/v1/banks/:id/import',
  'POST /api/v1/banks/:id/questions',
  'POST /api/v1/question-media',
  'POST /api/v1/banks/:id/questions/batch',
  'POST /api/v1/banks/:id/questions/bulk-delete',
  'POST /api/v1/banks/:id/questions/bulk-difficulty',
  'PUT /api/v1/questions/:id',
  'DELETE /api/v1/questions/:id',
  'POST /api/v1/questions/:id/image',
  'POST /api/v1/exams',
  'PUT /api/v1/exams/:id',
  'DELETE /api/v1/exams/:id',
  'GET /api/v1/exams/:id/paper',
  'GET /api/v1/exams/:id/points',
  'GET /api/v1/exams/:id/facets',
  'POST /api/v1/exams/:id/parallel',
  'GET /api/v1/exams/:id/pool',
  'GET /api/v1/exams/:id/blueprint',
  'GET /api/v1/exams/:id/paper.html',
  'POST /api/v1/exams/:id/compose',
  'GET /api/v1/exams/:id/questions/:qid/candidates',
  'GET /api/v1/exams/:id/taxonomy',
  'GET /api/v1/exams/:id/paper.docx',
  'GET /api/v1/analytics/overview',
  'GET /api/v1/analytics/points',
  'GET /api/v1/analytics/students',
  'GET /api/v1/analytics/wrong-questions',
  'GET /api/v1/analytics/wrong-questions.csv',
  'GET /api/v1/analytics/review.md',
  'POST /api/v1/exams/:id/questions/:qid/replace',
  'PUT /api/v1/exams/:id/questions/:qid',
  'POST /api/v1/exams/:id/questions/order',
  'PUT /api/v1/exams/:id/structure',
  'POST /api/v1/exams/:id/questions',
  'POST /api/v1/exams/:id/questions/random',
  'POST /api/v1/question-conflicts/sync',
  'POST /api/v1/question-conflicts/resolve-majority',
  'POST /api/v1/question-conflicts/resolve-equivalent',
  'POST /api/v1/question-conflicts/:hash/resolve',
  'POST /api/v1/question-conflicts/:hash/ignore',
  'POST /api/v1/question-conflicts/:hash/reopen',
  'GET /api/v1/questions/difficulty/preview',
  'POST /api/v1/questions/difficulty/apply',
  'POST /api/v1/questions/difficulty/calibrate',
  'DELETE /api/v1/exams/:id/questions/:qid',
  'GET /api/v1/exams/:id/scores',
  'GET /api/v1/exams/:id/scores.csv',
  'GET /api/v1/stats/lessons/:id',
  'GET /api/v1/stats/lessons/:id.csv',
  'GET /api/v1/stats/courses/:id',
  'GET /api/v1/stats/courses/:id.csv',
]);

/** 路由模式 + 方法 → 访问要求（用于 preValidation 统一判定） */
function requiredRoles(method: string, routeUrl: string | undefined): Role[] | null {
  if (routeUrl === undefined) return null; // 未匹配到路由：交给 404 处理器
  const key = `${method} ${routeUrl}`;
  if (ADMIN_ROUTES.has(key)) return ['admin'];
  if (TEACHER_ROUTES.has(key)) return ['admin', 'teacher'];
  return null; // 已登录即可（默认 fail-closed 只要求登录）
}

export function registerAuth(app: FastifyInstance, deps: { signer: SessionSigner; users: UserRepository }): void {
  app.decorateRequest('authUser', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const token = req.cookies[SessionSigner.cookieName()];
    const payload = deps.signer.verify(token);
    if (!payload) {
      req.authUser = null;
      return;
    }
    const row = deps.users.findById(payload.uid);
    req.authUser = row
      ? {
          id: row.id,
          username: row.username,
          role: row.role,
          display_name: row.display_name,
          created_at: row.created_at,
        }
      : null;
  });

  app.addHook('preValidation', async (req: FastifyRequest) => {
    const path = (req.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
    if (!path.startsWith('/api/')) return; // 静态资源与 SPA 回退不经过鉴权
    const routeUrl = (req.routeOptions as { url?: string } | undefined)?.url;
    // 未匹配到任何路由：交给 404 处理器返回统一错误信封，
    // 不在这里改判 401（否则探测未知路径的行为会变得不可预期）。
    if (routeUrl === undefined) return;
    if (PUBLIC_ROUTES.has(routeUrl)) return;
    const user = req.authUser;
    if (!user) throw AppError.unauthorized();
    const roles = requiredRoles(req.method, routeUrl);
    if (roles !== null && !roles.includes(user.role)) throw AppError.forbidden();
  });
}

export function requireUser(req: FastifyRequest, _reply: FastifyReply): User {
  if (!req.authUser) throw AppError.unauthorized();
  return req.authUser;
}

export function requireRole(req: FastifyRequest, _reply: FastifyReply, roles: Role[]): User {
  const user = requireUser(req, _reply);
  if (!roles.includes(user.role)) throw AppError.forbidden();
  return user;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): User {
  return requireRole(req, reply, ['admin']);
}

export function requireTeacherOrAdmin(req: FastifyRequest, reply: FastifyReply): User {
  return requireRole(req, reply, ['admin', 'teacher']);
}
