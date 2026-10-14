/**
 * 题库列表顺序回归：**新建的题库必须排在最前**。
 *
 * 背景（真机踩过）：题库有 1.2 万个，而列表接口一次只取前 300 条；
 * 原实现按 `id` 升序，新建题库的 id 最大 → 永远落在 300 条之外，
 * 老师刚提炼/新建的题库在界面上"建完就消失"，搜索之外根本没入口。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

let app: FastifyInstance;
let dataDir: string;
let cookie = '';

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bankorder-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  const db = new Db(':memory:');
  const built = await buildApp(config, { db });
  app = built.app;
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库列表顺序', () => {
  it('新建的题库排在最前（否则老师建完看不到）', async () => {
    for (const name of ['题库甲', '题库乙', '题库丙']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/banks',
        payload: { name, kind: 'chapter' },
        headers: { cookie },
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    const list = json<{ banks: { name: string }[]; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?limit=10', headers: { cookie } }),
    );
    expect(list.total).toBeGreaterThanOrEqual(3);
    // 最新的「题库丙」必须第一个出现
    expect(list.banks[0]?.name).toBe('题库丙');
    expect(list.banks.map((b) => b.name)).toEqual(['题库丙', '题库乙', '题库甲']);
  });

  it('总数与截断提示的依据（total 是过滤后的全量，不是本页条数）', async () => {
    const res = json<{ banks: unknown[]; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?limit=2', headers: { cookie } }),
    );
    expect(res.banks.length).toBe(2);
    // 服务端要给出真实总数，前端才能提示"只显示了前 N 个"
    expect(res.total).toBe(3);
  });
});
