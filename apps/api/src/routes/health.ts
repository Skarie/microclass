/**
 * 健康探针、版本信息与 OpenAPI 文档：容器编排 / 监控 / 前端联调接入用。
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { getAsyncDb } from '../db/driver.js';

const startedAt = Date.now();

export async function registerHealthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/healthz', { schema: { tags: ['system'], summary: '存活探针' } }, async () => ({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  /**
   * 就绪探针：探**当前驱动**是否真的可用。
   *
   * 切流前这里只 ping 同步 SQLite；`MC_DB=pg` 之后那样会永远 200（PG 挂了也 ready），
   * 而 `redeploy.sh` 正是拿 readyz 当「部署成功」的闸门 —— 会把错误配置判成成功。
   * 改走进程级 `AsyncDb`（sqlite 模式仍是同一个底层库，行为不变），并回报驱动名。
   */
  app.get('/readyz', { schema: { tags: ['system'], summary: '就绪探针（含数据库连通性）' } }, async (_req, reply) => {
    try {
      await getAsyncDb(deps.config, deps.db).get('SELECT 1 AS ok');
      return { status: 'ready', db: 'ok', driver: deps.config.dbDriver };
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
