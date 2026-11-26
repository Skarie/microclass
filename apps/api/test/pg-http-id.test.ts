/**
 * PG 分支的路径参数校验（2.4.3）：非数字 `:id` 必须是 400，不能是 bigint 500。
 *
 * 只在 `MC_PG_TEST_URL` 存在时运行（与 `pg-*.test.ts` 同一入口）：
 *   MC_PG_TEST_URL=postgres://microclass:***@db:5432/microclass_test \
 *     npx vitest run apps/api/test/pg-http-id.test.ts
 *
 * 为什么单独一个文件：这是**第一个在 PG 模式装配整站**的测试 —— 之前的 pg-*.test.ts
 * 都只测仓储层。用它锁住「真实 PG 驱动 + HTTP 路由」下 22P02 不再漏成 500。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import '../src/db/pg/pool.js'; // 副作用：int8（OID 20）→ number 的全局 parser
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { getAsyncDb } from '../src/db/driver.js';
import { closePg, pgEnabled, resetPgSchema } from './helpers/pgTestDb.js';

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

describe.skipIf(!pgEnabled)('PG：非数字 id → 400（不是 bigint 500）', () => {
  let app: FastifyInstance;
  let config: AppConfig | null = null;
  let sqliteDb: Db | null = null;
  let dataDir = '';
  let adminCookie = '';

  beforeAll(async () => {
    // 1) 重建测试库 schema（fixture 与生产同构；库名必须含 test，否则 helper 会拒绝）
    const seed = await resetPgSchema();
    await closePg(seed);

    // 2) 以 MC_DB=pg 装配整站：sqlite 只作为「未迁移域」的占位（生产也是同一套代码）
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pg-id-'));
    config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
      MC_LOG_LEVEL: 'silent',
      MC_DB: 'pg',
      MC_PG_URL: process.env.MC_PG_TEST_URL ?? '',
    });
    sqliteDb = new Db(':memory:');
    const built = await buildApp(config, { db: sqliteDb });
    app = built.app;
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    expect(login.statusCode).toBe(200);
    const c = login.cookies.find((x) => x.name === 'microclass_sid');
    adminCookie = c ? `microclass_sid=${c.value}` : '';
    expect(adminCookie).toContain('microclass_sid=');
  });

  afterAll(async () => {
    // beforeAll 中途失败时 app 可能没建起来：别用未定义对象再报一层错，掩盖真正的失败原因
    if (app) await app.close();
    // 关掉进程级 PG 池，否则 vitest 会因 idle 连接不退出
    if (config && sqliteDb) await getAsyncDb(config, sqliteDb).close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it.each(['/api/v1/questions/abc', '/api/v1/banks/abc', '/api/v1/exams/abc'])('%s → 400', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(400);
    const body = json<ErrorBody>(res);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('必须是正整数');
  });

  it('合法数字 id 仍走原语义（不存在 → 404，不是 400/500）', async () => {
    for (const url of ['/api/v1/questions/999999', '/api/v1/banks/999999', '/api/v1/exams/999999']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(404);
      expect(json<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    }
  });
});
