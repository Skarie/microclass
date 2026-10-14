/**
 * 按册次批量挂课程的 API 测试：
 *   - 只动未归属题库，且只动指定册次（同册次之外的题库不受影响）
 *   - 空册次按 "(无册次信息)" 归组（与界面目录一致）
 *   - 已挂到别门课的题库不会被抢走
 *   - 课程不存在 → 404；book 为空 → 400
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

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function createCourse(name: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    headers: { cookie },
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

async function createBank(name: string, book: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    headers: { cookie },
    payload: { name, kind: 'chapter', subject: '数学', book },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

async function unboundBooks(): Promise<{ book: string; bankCount: number }[]> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/banks/catalog', headers: { cookie } });
  return json<{ unboundBooks: { book: string; bankCount: number }[] }>(res).unboundBooks;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bindbook-'));
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
  cookie = await login('admin', 'admin123');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('按册次批量挂课程', () => {
  it('只把该册次的未归属题库挂到目标课程', async () => {
    const courseId = await createCourse('小学数学·三年级上册');
    await createBank('册次A-题库1', '册次A');
    await createBank('册次A-题库2', '册次A');
    await createBank('册次B-题库1', '册次B');
    await createBank('无册次-题库', '');

    const before = await unboundBooks();
    expect(before.find((b) => b.book === '册次A')?.bankCount).toBe(2);
    expect(before.find((b) => b.book === '册次B')?.bankCount).toBe(1);
    expect(before.find((b) => b.book === '(无册次信息)')?.bankCount).toBe(1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/bind-by-book',
      headers: { cookie },
      payload: { book: '册次A', courseId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ updated: number }>(res).updated).toBe(2);

    const after = await unboundBooks();
    expect(after.find((b) => b.book === '册次A')).toBeUndefined();
    expect(after.find((b) => b.book === '册次B')?.bankCount).toBe(1);
    expect(after.find((b) => b.book === '(无册次信息)')?.bankCount).toBe(1);

    const bound = await app.inject({
      method: 'GET',
      url: `/api/v1/banks?courseId=${courseId}`,
      headers: { cookie },
    });
    expect(json<{ total: number }>(bound).total).toBe(2);
  });

  it('空册次按 "(无册次信息)" 归组（与界面一致）', async () => {
    const courseId = await createCourse('小学数学·四年级上册');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/bind-by-book',
      headers: { cookie },
      payload: { book: '(无册次信息)', courseId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ updated: number }>(res).updated).toBeGreaterThanOrEqual(1);
  });

  it('不会抢走已挂到其它课程的题库；课程不存在报 404；册次为空报 400', async () => {
    const other = await createCourse('初中化学·九年级上册');
    const bankId = await createBank('已归属题库', '册次C');
    await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${bankId}`,
      headers: { cookie },
      payload: { name: '已归属题库', courseId: other },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/bind-by-book',
      headers: { cookie },
      payload: { book: '册次C', courseId: await createCourse('另一门课') },
    });
    expect(again.statusCode).toBe(200);
    // 该册次下已无未归属题库 → 不会把已归属的抢走
    expect(json<{ updated: number }>(again).updated).toBe(0);

    const notFound = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/bind-by-book',
      headers: { cookie },
      payload: { book: '册次D', courseId: 999999 },
    });
    expect(notFound.statusCode).toBe(404);

    const badBook = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/bind-by-book',
      headers: { cookie },
      payload: { book: '', courseId: other },
    });
    expect(badBook.statusCode).toBe(400);
  });
});
