/**
 * 跨站请求防护（CSRF 的纵深防御）。
 *
 * 现状：会话 Cookie 为 `SameSite=Lax`，浏览器不会在跨站 POST 中携带它，
 * 因此经典 CSRF 已被挡住。这里再加一道 **Origin 校验**，作为纵深防御。
 *
 * 规则（非安全方法 POST/PUT/PATCH/DELETE）：
 *   - 没有 Origin（curl / 服务端调用 / 老浏览器）→ 放行（无 Cookie 自动携带风险）；
 *   - Origin 与「本服务外部地址」同源 → 放行；外部地址从 Host / X-Forwarded-Host /
 *     X-Original-Host / Forwarded 头综合推导（反代会改写其中某几个）；
 *   - Origin 只看主机名也相同（协议不同）→ 放行：反代终止 TLS 时后端常是 http，
 *     `https://mc.example.com` 与 `http://mc.example.com` 属于同一站点，拦它没有安全收益；
 *   - Origin 命中 `MC_ALLOWED_ORIGINS` 白名单 → 放行，支持 `https://*.example.com` 通配。
 *
 * 从外网访问报 "Origin 不被信任" 的常见原因与修复见 docs/deploy.md「外网访问」一节。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '@microclass/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 规范化：去尾部斜杠、小写、去默认端口 */
function normalizeOrigin(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '').toLowerCase();
  s = s.replace(/:443$/, '').replace(/:80$/, '');
  return s;
}

/** 取 URL 的 host（含端口），失败返回空串 */
function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return m?.[1] ? m[1].toLowerCase() : '';
}

/** 从请求头推导「本服务的外部地址」候选（含反代透传的各类头） */
function selfHosts(req: FastifyRequest): string[] {
  const hosts = new Set<string>();
  const push = (v: string | string[] | undefined): void => {
    if (!v) return;
    for (const part of Array.isArray(v) ? v : v.split(',')) {
      const h = part.trim().toLowerCase();
      if (h) hosts.add(h);
    }
  };
  push(req.headers.host);
  push(req.headers['x-forwarded-host'] as string | undefined);
  push(req.headers['x-original-host'] as string | undefined);
  push(req.headers['x-real-host'] as string | undefined);
  // Forwarded: for=...;host=example.com;proto=https
  const forwarded = req.headers.forwarded;
  if (typeof forwarded === 'string') {
    for (const seg of forwarded.split(',')) {
      const m = /host=([^;]+)/i.exec(seg);
      if (m?.[1]) push(m[1].replace(/^"|"$/g, ''));
    }
  }
  return [...hosts];
}

/** 白名单匹配：支持精确值与 `https://*.example.com` 通配 */
function matchesAllowList(origin: string, allowList: string[]): boolean {
  const o = normalizeOrigin(origin);
  const oHost = hostOf(o);
  for (const raw of allowList) {
    const entry = normalizeOrigin(raw);
    if (!entry) continue;
    if (entry === o) return true;
    if (entry.includes('*')) {
      const eHost = hostOf(entry);
      const suffix = eHost.startsWith('*.') ? eHost.slice(1) : eHost;
      if (eHost.startsWith('*.') && oHost.endsWith(suffix) && oHost.length > suffix.length) return true;
    }
  }
  return false;
}

export function registerOriginCheck(app: FastifyInstance, config: { allowedOrigins: string[] }): void {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    // 非浏览器客户端不带 Origin：无 Cookie 自动携带风险，放行
    if (typeof origin !== 'string' || origin === '') return;

    const normalized = normalizeOrigin(origin);
    if (matchesAllowList(origin, config.allowedOrigins)) return;

    const hosts = selfHosts(req);
    // 同源（协议+主机都一致）或同主机（反代终止 TLS 导致协议不同）
    const originHost = hostOf(normalized);
    if (hosts.includes(originHost)) return;
    const originHostname = originHost.split(':')[0] ?? '';
    if (hosts.some((h) => h.split(':')[0] === originHostname && originHostname !== '')) return;

    req.log.warn({ origin }, '堵住了一个 Origin 不在信任列表的写请求');
    throw AppError.forbidden(
      `跨站请求被拒绝：Origin 不被信任（${origin}）。` +
        `如果你是通过反向代理/域名从外网访问，请在环境变量 MC_ALLOWED_ORIGINS 里加上该地址（逗号分隔，支持 https://*.example.com），` +
        `并确认反代透传了 Host 与 X-Forwarded-Proto；详见 docs/deploy.md「外网访问」。`,
    );
  });
}
