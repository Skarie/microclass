/**
 * 健康探针、版本信息与 OpenAPI 文档：容器编排 / 监控 / 前端联调接入用。
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/healthz', { schema: { tags: ['system'], summary: '存活探针' } }, async () => ({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  app.get('/readyz', { schema: { tags: ['system'], summary: '就绪探针（含数据库连通性）' } }, async (_req, reply) => {
    try {
      deps.db.get('SELECT 1 AS ok');
      return { status: 'ready', db: 'ok' };
    } catch (e) {
      void reply.status(503);
      return { status: 'not-ready', db: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get('/version', { schema: { tags: ['system'], summary: '版本信息' } }, async () => ({
    name: 'microclass',
    version: process.env.MC_VERSION ?? '2.0.0',
    env: deps.config.env,
    node: process.version,
  }));

  /** OpenAPI 3.1 文档：由各路由的 JSON Schema 自动汇总 */
  app.get('/openapi.json', { schema: { tags: ['system'], summary: 'OpenAPI 文档' } }, async () => app.swagger());
}
