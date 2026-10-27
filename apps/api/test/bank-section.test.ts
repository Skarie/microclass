/**
 * 题库章节（迁移 0023）：创建/编辑入参、列表与详情的 section 字段、
 * 按 section 筛选（空串 = 未分章）、绑定课时自动继承 group_name。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface BankDetail {
  bank: {
    id: number;
    name: string;
    section: string;
    book: string;
    lesson_id: number | null;
    course_id: number | null;
  };
}

interface BankList {
  banks: { id: number; section: string }[];
  total: number;
}

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function createBank(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/banks', headers: { cookie }, payload });
  expect(res.statusCode).toBe(200);
  return json<{ id: number }>(res).id;
}

async function detailOf(id: number): Promise<BankDetail['bank']> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/banks/${id}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<BankDetail>(res).bank;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bank-section-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  db = new Db(':memory:');
  const built = await buildApp(config, { db });
  app = built.app;
  await app.ready();
  cookie = await login('admin', 'admin123');

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['小学数学·三年级上册（新）']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    '1 时、分、秒',
    '第一章 时、分、秒',
  ]);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (2, ?, 1, ?, 2)', ['2 时间的计算', '']);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库章节的增改查', () => {
  it('绑定课时且不传 section → 自动继承 group_name', async () => {
    const id = await createBank({ name: '课时库', lessonId: 1, book: '三年级上册（新）' });
    const bank = await detailOf(id);
    expect(bank.section).toBe('第一章 时、分、秒');
    expect(bank.lesson_id).toBe(1);
  });

  it('显式 section 优先于课时 group_name，并 trim 首尾空格', async () => {
    const id = await createBank({ name: '显式章节库', lessonId: 1, section: '  第三章 乘法  ' });
    expect((await detailOf(id)).section).toBe('第三章 乘法');
  });

  it('超长 section 截断到 120 字（不报错）', async () => {
    const long = `第一章 ${'测'.repeat(300)}`;
    expect(long.length).toBeGreaterThan(120);
    const id = await createBank({ name: '超长章节库', section: long });
    const section = (await detailOf(id)).section;
    expect(section).toHaveLength(120);
    expect(section.startsWith('第一章 测')).toBe(true);
  });

  it('只给 courseId 不给 lessonId → 不强行推导章节', async () => {
    const id = await createBank({ name: '课程库', courseId: 1 });
    const bank = await detailOf(id);
    expect(bank.section).toBe('');
    expect(bank.course_id).toBe(1);
  });

  it('编辑：不传 section 保留原值；传空串则重新继承课时 group_name', async () => {
    const id = await createBank({ name: '可编辑章节库', section: '第二章 测量' });

    const rename = await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${id}`,
      headers: { cookie },
      payload: { name: '可编辑章节库（改名）' },
    });
    expect(rename.statusCode).toBe(200);
    expect((await detailOf(id)).section).toBe('第二章 测量');

    const blank = await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${id}`,
      headers: { cookie },
      payload: { name: '可编辑章节库（改名）', lessonId: 2, section: '' },
    });
    expect(blank.statusCode).toBe(200);
    expect((await detailOf(id)).section).toBe(''); // 课时本身没有 group_name

    const inherit = await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${id}`,
      headers: { cookie },
      payload: { name: '可编辑章节库（改名）', lessonId: 1, section: '' },
    });
    expect(inherit.statusCode).toBe(200);
    expect((await detailOf(id)).section).toBe('第一章 时、分、秒');
  });

  it('编辑：显式改成新章节', async () => {
    const id = await createBank({ name: '待改章节库', section: '第一章 集合' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${id}`,
      headers: { cookie },
      payload: { name: '待改章节库', section: '第二章 函数' },
    });
    expect(res.statusCode).toBe(200);
    expect((await detailOf(id)).section).toBe('第二章 函数');
  });
});

describe('按 section 筛选题库', () => {
  it('空串只筛未分章；具体章节精确匹配；不传则不过滤', async () => {
    const unclassified = json<BankList>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?section=', headers: { cookie } }),
    );
    expect(unclassified.banks.length).toBeGreaterThan(0);
    expect(unclassified.banks.every((b) => b.section === '')).toBe(true);

    const chapter = json<BankList>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/banks?section=${encodeURIComponent('第二章 函数')}`,
        headers: { cookie },
      }),
    );
    expect(chapter.banks.length).toBe(1);
    expect(chapter.banks[0]?.section).toBe('第二章 函数');

    const all = json<BankList>(await app.inject({ method: 'GET', url: '/api/v1/banks', headers: { cookie } }));
    expect(all.total).toBeGreaterThan(chapter.banks.length);
    expect(all.banks.some((b) => b.section === '')).toBe(true);
    expect(all.banks.some((b) => b.section !== '')).toBe(true);
  });
});
