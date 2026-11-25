/**
 * 题库关键字搜索的**大小写不敏感**回归测试。
 *
 * 背景：SQLite 的 `LIKE` 对 ASCII 默认不区分大小写，PostgreSQL 的 `LIKE` 区分。
 * 迁移到 PG 后如果仍是 `LIKE`，`keyword=java` 会搜不到「Java 基础」。
 * 统一用 `LOWER(列) LIKE LOWER(?)`（见 `db/sql.ts` 的 likeCI），两库语义一致。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';

let dataDir: string;
let built: BuiltApp;
let cookie = '';

function json<T>(res: { body: string }): T {
  return JSON.parse(res.body) as T;
}

interface BankListItem {
  id: number;
  name: string;
}

async function search(keyword: string): Promise<BankListItem[]> {
  const res = await built.app.inject({
    method: 'GET',
    url: `/api/v1/banks?keyword=${encodeURIComponent(keyword)}`,
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (
    json<{ banks?: BankListItem[]; items?: BankListItem[] }>(res).banks ?? json<{ items: BankListItem[] }>(res).items
  );
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-search-case-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  built = await buildApp(config, { db: new Db(':memory:') });
  await built.app.ready();

  const login = await built.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  const created = await built.app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    headers: { cookie },
    payload: { name: 'Java 基础', kind: 'chapter', subject: '编程', book: 'Java 教程' },
  });
  expect(created.statusCode, created.body).toBe(200);
});

afterAll(async () => {
  await built.app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库关键字搜索：大小写不敏感', () => {
  it('小写关键词能搜到首字母大写的库名', async () => {
    const list = await search('java');
    expect(list.map((b) => b.name)).toContain('Java 基础');
  });

  it('全大写关键词也能搜到', async () => {
    const list = await search('JAVA');
    expect(list.map((b) => b.name)).toContain('Java 基础');
  });

  it('完全不匹配的关键词搜不到', async () => {
    const list = await search('python');
    expect(list.map((b) => b.name)).not.toContain('Java 基础');
  });
});
