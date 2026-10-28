/**
 * 题库列表 / 创建 / 编辑与文件夹的联动：
 * folderId 直属过滤（none = 未分类）、返回 folderId / folderPath / courseName / lessonTitle、
 * 创建与编辑时的 folderId 校验（null = 移出，不传 = 不变）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface BankItem {
  id: number;
  name: string;
  folderId: number | null;
  folderPath: string;
  courseName: string;
  lessonTitle: string;
  lesson_title: string;
  question_count: number;
}

interface BankList {
  banks: BankItem[];
  total: number;
}

interface BankDetail {
  bank: BankItem;
}

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';
let folderF1 = 0;
let folderF1a = 0;
let folderF2 = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function createFolder(name: string, parentId?: number | null): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/banks/folders',
    headers: { cookie },
    payload: parentId === undefined ? { name } : { name, parentId },
  });
  expect(res.statusCode).toBe(201);
  return json<{ folder: { id: number } }>(res).folder.id;
}

async function createBank(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/banks', headers: { cookie }, payload });
  expect(res.statusCode).toBe(200);
  return json<{ id: number }>(res).id;
}

async function list(query = ''): Promise<BankList> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/banks${query}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<BankList>(res);
}

async function detail(id: number): Promise<BankItem> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/banks/${id}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<BankDetail>(res).bank;
}

async function updateBank(id: number, payload: Record<string, unknown>): Promise<void> {
  const res = await app.inject({ method: 'PUT', url: `/api/v1/banks/${id}`, headers: { cookie }, payload });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bank-folder-banks-'));
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

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['java']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['语文']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    'Java 入门',
    '第一章',
  ]);
  folderF1 = await createFolder('必刷题');
  folderF1a = await createFolder('第一章', folderF1);
  folderF2 = await createFolder('初中七年级数学');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题库返回新增字段', () => {
  it('folderId / folderPath / courseName / lessonTitle 同时给出', async () => {
    const id = await createBank({ name: 'Java 基础', folderId: folderF1a, lessonId: 1 });
    const body = await list(`?folderId=${folderF1a}`);
    expect(body.total).toBe(1);
    expect(body.banks[0]).toMatchObject({
      id,
      folderId: folderF1a,
      folderPath: '必刷题 / 第一章',
      courseName: 'java',
      lessonTitle: 'Java 入门',
      // 旧的 snake_case 字段保持兼容
      lesson_title: 'Java 入门',
    });
    expect(await detail(id)).toMatchObject({
      folderId: folderF1a,
      folderPath: '必刷题 / 第一章',
      courseName: 'java',
      lessonTitle: 'Java 入门',
    });
  });

  it('未分类 / 未关联课程时为空串或 null', async () => {
    const id = await createBank({ name: '未分类题库' });
    const bank = await detail(id);
    expect(bank).toMatchObject({ folderId: null, folderPath: '', courseName: '', lessonTitle: '' });
    const unfiled = await list('?folderId=none');
    expect(unfiled.total).toBe(1);
    expect(unfiled.banks[0]?.id).toBe(id);
  });

  it('创建时 folderId 不存在 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie },
      payload: { name: '脏引用', folderId: 99999 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('编辑题库的 folderId 语义', () => {
  it('移动到文件夹、移出到未分类、不传时保持不变', async () => {
    const id = await createBank({ name: '可移动题库', folderId: folderF1 });
    expect((await detail(id)).folderId).toBe(folderF1);

    await updateBank(id, { name: '可移动题库', folderId: folderF2 });
    expect(await detail(id)).toMatchObject({ folderId: folderF2, folderPath: '初中七年级数学' });

    await updateBank(id, { name: '可移动题库', folderId: null });
    expect(await detail(id)).toMatchObject({ folderId: null, folderPath: '' });

    await updateBank(id, { name: '可移动题库', folderId: folderF1 });
    await updateBank(id, { name: '只改名字' });
    expect(await detail(id)).toMatchObject({ name: '只改名字', folderId: folderF1 });
  });

  it('编辑时 folderId 不存在 400', async () => {
    const id = await createBank({ name: '编辑校验' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/banks/${id}`,
      headers: { cookie },
      payload: { name: '编辑校验', folderId: 99999 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('folderId 筛选', () => {
  it('数字只看直属题库（不含子文件夹），none 只看未分类，非法值 400', async () => {
    const direct = await createBank({ name: 'F1 直属', folderId: folderF1 });
    const nested = await createBank({ name: 'F1a 直属', folderId: folderF1a });

    const f1 = await list(`?folderId=${folderF1}`);
    const f1Ids = f1.banks.map((b) => b.id);
    expect(f1Ids).toContain(direct);
    expect(f1Ids).not.toContain(nested);
    expect(f1.banks.every((b) => b.folderId === folderF1)).toBe(true);

    const f1a = await list(`?folderId=${folderF1a}`);
    expect(f1a.banks.map((b) => b.id)).toContain(nested);

    const none = await list('?folderId=none');
    expect(none.banks.every((b) => b.folderId === null)).toBe(true);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/banks?folderId=abc',
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('与 keyword 等既有筛选可以组合', async () => {
    await createBank({ name: '组合筛选关键词', folderId: folderF2 });
    const body = await list(`?folderId=${folderF2}&keyword=组合`);
    expect(body.total).toBe(1);
    expect(body.banks[0]?.name).toBe('组合筛选关键词');
  });
});
