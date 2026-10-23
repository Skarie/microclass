/**
 * 题库 / 题目路由清单守护：`routes/banks.ts` 拆成 `banks-*.ts` 后，原路由一条都不能少。
 *
 * 清单来自拆分前的 `routes/banks.ts`（31 条）；用构建后的 Fastify 实例
 * `app.hasRoute({ method, url })` 逐条核对方法 + 完整路径（含 `/api/v1` 前缀），
 * 比「按 handler 文件 grep」更能发现注册器漏调、路径拼错、前缀丢失。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 拆分前 `routes/banks.ts` 注册的全部路由（路径不含 /api/v1 前缀） */
const BANK_ROUTES: { method: Method; url: string }[] = [
  { method: 'GET', url: '/banks' },
  { method: 'POST', url: '/banks' },
  { method: 'GET', url: '/banks/catalog' },
  { method: 'POST', url: '/banks/bind-by-book' },
  { method: 'POST', url: '/banks/rebind-courses' },
  { method: 'POST', url: '/banks/fix-question-counts' },
  { method: 'GET', url: '/banks/health' },
  { method: 'GET', url: '/banks/template.csv' },
  { method: 'GET', url: '/banks/template.md' },
  { method: 'GET', url: '/banks/:id' },
  { method: 'PUT', url: '/banks/:id' },
  { method: 'DELETE', url: '/banks/:id' },
  { method: 'POST', url: '/banks/:id/exam' },
  { method: 'POST', url: '/banks/:id/dedupe' },
  { method: 'GET', url: '/banks/:id/questions' },
  { method: 'POST', url: '/banks/:id/questions' },
  { method: 'POST', url: '/banks/:id/questions/bulk-delete' },
  { method: 'POST', url: '/banks/:id/questions/bulk-difficulty' },
  { method: 'POST', url: '/banks/:id/questions/batch' },
  { method: 'POST', url: '/banks/:id/import' },
  { method: 'GET', url: '/banks/:id/export.csv' },
  { method: 'GET', url: '/banks/:id/export.md' },
  { method: 'GET', url: '/banks/:id/export.docx' },
  { method: 'GET', url: '/questions/search' },
  { method: 'GET', url: '/questions/:id' },
  { method: 'PUT', url: '/questions/:id' },
  { method: 'DELETE', url: '/questions/:id' },
  { method: 'POST', url: '/questions/:id/image' },
  { method: 'GET', url: '/question-images/:id' },
  { method: 'POST', url: '/question-media' },
  { method: 'GET', url: '/question-media/:file' },
];

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bankroutes-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  const built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库路由清单（拆分后）', () => {
  it('31 条原路由全部保留：方法 + 完整路径一致', () => {
    expect(BANK_ROUTES).toHaveLength(31);
    const missing = BANK_ROUTES.filter(
      (route) => !app.hasRoute({ method: route.method, url: `/api/v1${route.url}` }),
    ).map((route) => `${route.method} ${route.url}`);
    expect(missing).toEqual([]);
  });

  it('题库根路径同时注册列表与新建（GET / POST 不互相覆盖）', () => {
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/banks' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/banks' })).toBe(true);
  });

  it('题目与题图的公共路径仍挂在 /api/v1 下', () => {
    for (const url of ['/api/v1/questions/search', '/api/v1/question-images/:id', '/api/v1/question-media/:file']) {
      expect(app.hasRoute({ method: 'GET', url }), url).toBe(true);
    }
  });
});
