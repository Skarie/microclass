#!/usr/bin/env node
/**
 * 微课堂 · fnOS 学生端网关
 *
 * 职责（没有任何第三方依赖，只用 node 内置模块）：
 *   1. 同源托管学生端前端构建产物（<程序目录>/server/web）；
 *   2. 把 /api/* 反向代理到 Docker 生产 API（默认 http://127.0.0.1:8091）；
 *   3. SPA 路由回退到 index.html。
 *
 * 为什么用反代而不是再存一份数据：账号、学习记录、题库只有一份（在 Docker 里），
 * 学生在 fnOS 应用里登录/做题写的就是生产库，管理端立刻能看到，不存在「两边不同步」。
 *
 * 环境变量：
 *   MC_PORT      监听端口（默认 8092）
 *   MC_HOST      监听地址（默认 0.0.0.0）
 *   MC_WEB_DIST  前端产物目录（默认 ./web）
 *   MC_UPSTREAM  生产 API 地址（默认 http://127.0.0.1:8091）
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.MC_PORT ?? 8092);
const HOST = process.env.MC_HOST ?? '0.0.0.0';
const WEB_DIR = path.resolve(process.env.MC_WEB_DIST ?? path.join(import.meta.dirname ?? '.', 'web'));
const UPSTREAM = new URL(process.env.MC_UPSTREAM ?? 'http://127.0.0.1:8091');
const UPSTREAM_PORT = Number(UPSTREAM.port || (UPSTREAM.protocol === 'https:' ? 443 : 80));

/** 静态资源类型（前端产物只用到这些） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function hopByHop(headers) {
  const out = { ...headers };
  for (const h of ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']) {
    delete out[h];
  }
  return out;
}

/** /api/* → 生产 API（流式，保留 Range / Set-Cookie，视频拖动进度条也能用） */
function proxyApi(req, res) {
  const headers = hopByHop(req.headers);
  headers.host = UPSTREAM.host;
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';
  headers['x-forwarded-proto'] = 'http';
  headers['x-forwarded-host'] = req.headers.host ?? '';

  const upstreamReq = http.request(
    {
      protocol: UPSTREAM.protocol,
      hostname: UPSTREAM.hostname,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, hopByHop(upstreamRes.headers));
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => res.destroy());
    },
  );

  // 视频/大文件可能持续几分钟，不能设超时
  upstreamReq.setTimeout(0);
  upstreamReq.on('error', (err) => {
    const message = `无法连接微课堂服务（${UPSTREAM.host}）：${err.message}`;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (req.url?.includes('/api/')) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'upstream_unavailable', message }));
    } else {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>微课堂暂不可用</title>` +
          `<h1>微课堂暂时无法连接</h1><p>${message}</p>` +
          `<p>请确认管理端（<code>${UPSTREAM.host}</code>）正在运行。</p>`,
      );
    }
  });

  req.on('aborted', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
}

/** 静态文件 + SPA 回退 */
function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  const indexFile = path.join(WEB_DIR, 'index.html');
  const candidate = path.join(WEB_DIR, pathname);
  // 防目录穿越
  const inside = candidate === WEB_DIR || candidate.startsWith(WEB_DIR + path.sep);
  const isFile = inside && existsSync(candidate) && statSync(candidate).isFile();

  if (!isFile && !existsSync(indexFile)) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><h1>学生端前端未构建</h1><p>缺少 index.html。</p>');
    return;
  }

  const file = isFile ? candidate : indexFile;
  const ext = path.extname(file).toLowerCase();
  const isHashedAsset = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // 带 hash 的产物可长缓存；index.html 必须回源，否则升级后拿到旧壳
    'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    proxyApi(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  serveStatic(req, res);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.listen(PORT, HOST, () => {
  console.log(`[student-gateway] 监听 http://${HOST}:${PORT}，静态目录 ${WEB_DIR}，/api → ${UPSTREAM.origin}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[student-gateway] 收到 ${signal}，关闭`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
