/**
 * 路径参数 `:id` 的整数校验（统一 helper + 全局 preValidation 守卫）。
 *
 * 背景（2026-11-27，2.4.2 + PG）：`GET /api/v1/questions/abc`、`/banks/abc`、`/exams/abc`
 * 在 SQLite 上只是查不到（404），切到 PG 后直接把 `'abc'` 当 bigint 绑参，
 * PostgreSQL 抛 `invalid input syntax for type bigint`（22P02），落到统一错误处理器变成 500。
 * 客户端拼错 id / 爬虫扫路径属于**客户端错误**，应该是 400，而不是把数据库错误暴露成 500。
 *
 * 做法：
 *  - `parseIntegerId()`：单个入口，非正整数抛 `AppError.badRequest`（统一错误信封 400）；
 *  - `registerIntegerIdGuard()`：在 v1 作用域挂 `preValidation`，把**所有**路由的
 *    `id` / `qid` / `questionId` 路径参数一次性挡住 —— 新增 `:id` 路由自动受保护，
 *    不需要每个 handler 记得写校验。
 *
 * 为什么不用 Fastify params schema：60+ 条 `:id` 路由逐个补 schema 既啰嗦又容易漏；
 * 而且 schema 校验失败会走 `validation` 分支（details 是 AJV 结构），
 * 与项目里其他 `AppError.badRequest` 的文案风格不一致。
 *
 * 顺序：鉴权钩子是**根级** `preValidation`（`http/guards.ts`），先于这里的 v1 作用域钩子执行，
 * 所以未登录访问 `/questions/abc` 仍是 401，登录后才是 400。
 *
 * 例外：`/question-conflicts/:hash`、`/question-media/:file`、`/paper-assets/fonts/:file`
 * 这类参数不是主键，不在本守卫的名单里；`/media-roots/:id/*` 的 `:id` 是**字符串 slug**
 * （媒体根目录 id 形如 `site-uploads` / `math7`，见 `.env` 的 `MC_MEDIA_ROOTS`），也必须放过。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';

/** 需要按整数主键校验的路径参数（其余 `:file` / `:hash` 等保持原样） */
const INTEGER_PARAMS = new Set(['id', 'qid', 'questionId']);

/** `:id` 是字符串（不是整数主键）的路由：媒体根目录 id 是用户自定义 slug */
const STRING_ID_ROUTE = /\/media-roots\/:id(\/|$)/;

const PARAM_LABEL: Record<string, string> = {
  id: 'id',
  qid: '题目 id',
  questionId: '题目 id',
};

/** 解析路径里的整数主键：只接受正的安全整数，其余一律 400 */
export function parseIntegerId(raw: string, label: string): number {
  const id = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw AppError.badRequest(`${label} 非法（必须是正整数）`, { param: label, value: raw.slice(0, 32) });
  }
  return id;
}

/** 校验一个 `params` 对象里所有整数主键（供钩子与单测直接调用） */
export function assertIntegerIdParams(params: unknown): void {
  if (params === null || typeof params !== 'object') return;
  for (const [name, raw] of Object.entries(params as Record<string, unknown>)) {
    if (!INTEGER_PARAMS.has(name) || typeof raw !== 'string') continue;
    parseIntegerId(raw, PARAM_LABEL[name] ?? name);
  }
}

/**
 * 注册全局守卫（挂在 `/api/v1` 插件作用域内）：非整数 `:id` 在进入 handler 之前就 400，
 * SQL 层永远不会拿到 `'abc'` 这种值。
 */
export function registerIntegerIdGuard(app: FastifyInstance): void {
  app.addHook('preValidation', async (req: FastifyRequest) => {
    if (!req.url.startsWith('/api/')) return;
    const routeUrl = (req.routeOptions as { url?: string } | undefined)?.url;
    if (routeUrl !== undefined && STRING_ID_ROUTE.test(routeUrl)) return;
    assertIntegerIdParams(req.params);
  });
}
