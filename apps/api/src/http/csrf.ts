/**
 * 跨站请求防护（CSRF 的纵深防御）。
 *
 * 现状：会话 Cookie 为 `SameSite=Lax`，浏览器不会在跨站 POST 中携带它，
 * 因此经典 CSRF 已被挡住。但一旦将来改用 `SameSite=None`（例如前后端分域部署），
 * 或客户端出现实现差异，仅靠 SameSite 就不够了。
 *
 * 这里再加一道 **Origin 校验**：所有「非安全方法」（POST/PUT/PATCH/DELETE）必须满足
 *   - 请求头没有 Origin（curl / 服务端调用 / 老浏览器）→ 放行；或
 *   - Origin 与请求的 Host 同源；或
 *   - Origin 在 `MC_ALLOWED_ORIGINS` 白名单内（反代改写了 Host 的部署场景）。
 * 否则返回 403。浏览器对跨站表单/跨站 fetch 一定会带 Origin，因此跨站伪造会被拒绝。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 从请求头推导「本服务的外部地址」候选（含反代透传的 host/proto） */
function selfOrigins(req: FastifyRequest): string[] {
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (!host) return [];
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const hosts = host
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const protos = proto ? [proto] : ['http', 'https'];
  const out: string[] = [];
  for (const h of hosts) for (const p of protos) out.push(`${p}://${h}`);
  return out;
}

export function registerOriginCheck(app: FastifyInstance, config: { allowedOrigins: string[] }): void {
  const allowList = new Set(config.allowedOrigins);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    // 非浏览器客户端不带 Origin：无 Cookie 自动携带风险，放行
    if (typeof origin !== 'string' || origin === '') return;

    const normalized = origin.replace(/\/+$/, '');
    if (allowList.has(normalized)) return;
    if (selfOrigins(req).includes(normalized)) return;

    throw AppError.forbidden('跨站请求被拒绝：Origin 不被信任');
  });
}
