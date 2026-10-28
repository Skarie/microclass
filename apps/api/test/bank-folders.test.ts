/**
 * 题库文件夹 API：树 + 含子孙计数、未分类统计、创建 / 改名 / 移动 / 删除、权限。
 *
 * 树数据直接写库（folder_id + question_count），CRUD 全部走 HTTP，覆盖真实路由与校验。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface FolderNode {
  id: number;
  parentId: number | null;
  name: string;
  sort: number;
  bankCount: number;
  questionCount: number;
  folderCount: number;
  children: FolderNode[];
}

interface FolderTree {
  folders: FolderNode[];
  unfiled: { bankCount: number; questionCount: number };
}

interface FolderResponse {
  folder: { id: number; parentId: number | null; name: string; sort: number };
}

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let adminCookie = '';
let studentCookie = '';

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
    headers: { cookie: adminCookie },
    payload: parentId === undefined ? { name } : { name, parentId },
  });
  expect(res.statusCode).toBe(201);
  return json<FolderResponse>(res).folder.id;
}

async function getTree(cookie = adminCookie): Promise<FolderTree> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/banks/folders', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<FolderTree>(res);
}

function seedBank(
  id: number,
  name: string,
  folderId: number | null,
  questionCount: number,
  courseId: number | null = null,
  lessonId: number | null = null,
): void {
  db.run(
    `INSERT INTO banks (id, name, kind, subject, book, section, course_id, lesson_id, folder_id, question_count)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, name, 'lesson', '数学', '', '', courseId, lessonId, folderId, questionCount],
  );
}

let rootA = 0;
let childA1 = 0;
let grandA1a = 0;
let rootB = 0;
let childB1 = 0;
let empty = 0;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bank-folder-api-'));
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
  adminCookie = await login('admin', 'admin123');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['java']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['语文']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    'Java 入门',
    '第一章',
  ]);

  rootA = await createFolder('初中七年级数学');
  childA1 = await createFolder('第一章', rootA);
  grandA1a = await createFolder('第一节', childA1);
  rootB = await createFolder('必刷题');
  childB1 = await createFolder('第一章', rootB);
  empty = await createFolder('空文件夹');

  seedBank(1, 'A 直属', rootA, 3);
  seedBank(2, 'A1 直属', childA1, 5);
  seedBank(3, 'A1a 直属', grandA1a, 7);
  seedBank(4, 'B1 直属', childB1, 11);
  seedBank(5, '未分类 1', null, 13, 1, 1);
  seedBank(6, '未分类 2', null, 17, 2, null);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /banks/folders：树与计数', () => {
  it('按 sort/id 排序，bankCount/questionCount 含子孙，folderCount 为直接子层', async () => {
    const body = await getTree();
    expect(body.folders.map((f) => f.name)).toEqual(['初中七年级数学', '必刷题', '空文件夹']);
    expect(body.folders.map((f) => f.sort)).toEqual([0, 1, 2]);
    expect(body.unfiled).toEqual({ bankCount: 2, questionCount: 30 });

    const a = body.folders[0]!;
    expect(a).toMatchObject({ id: rootA, parentId: null, bankCount: 3, questionCount: 15, folderCount: 1 });
    const a1 = a.children[0]!;
    expect(a1).toMatchObject({
      id: childA1,
      parentId: rootA,
      bankCount: 2,
      questionCount: 12,
      folderCount: 1,
    });
    expect(a1.children[0]).toMatchObject({ id: grandA1a, bankCount: 1, questionCount: 7, folderCount: 0 });

    const b = body.folders[1]!;
    expect(b).toMatchObject({ bankCount: 1, questionCount: 11, folderCount: 1 });
    expect(b.children[0]).toMatchObject({ id: childB1, bankCount: 1, questionCount: 11, children: [] });
    expect(body.folders[2]).toMatchObject({ id: empty, bankCount: 0, questionCount: 0, folderCount: 0 });
  });

  it('学生可读，未登录 401', async () => {
    const asStudent = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/folders',
      headers: { cookie: studentCookie },
    });
    expect(asStudent.statusCode).toBe(200);
    const anon = await app.inject({ method: 'GET', url: '/api/v1/banks/folders' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('POST /banks/folders', () => {
  it('创建顶层 / 子文件夹：201，name trim，返回 folder', async () => {
    const top = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '  新建顶层  ' },
    });
    expect(top.statusCode).toBe(201);
    expect(json<FolderResponse>(top).folder).toMatchObject({ parentId: null, name: '新建顶层' });

    const parentId = json<FolderResponse>(top).folder.id;
    const child = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '子级', parentId },
    });
    expect(child.statusCode).toBe(201);
    expect(json<FolderResponse>(child).folder).toMatchObject({ name: '子级', parentId });
  });

  it('同级重名 409；不同父级可以同名', async () => {
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '必刷题' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(json<{ error: { message: string } }>(duplicate).error.message).toBe('同级已存在同名文件夹');

    // 根 A 与根 B 下都有「第一章」
    expect(childA1).not.toBe(childB1);
    const sameNameOtherParent = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '第一章', parentId: rootB },
    });
    expect(sameNameOtherParent.statusCode).toBe(409);
    const underEmpty = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '第一章', parentId: empty },
    });
    expect(underEmpty.statusCode).toBe(201);
  });

  it('父文件夹不存在 400；名称为空 / 超长 400', async () => {
    const noParent = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: 'x', parentId: 99999 },
    });
    expect(noParent.statusCode).toBe(400);
    const blank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    const long = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: adminCookie },
      payload: { name: 'x'.repeat(121) },
    });
    expect(long.statusCode).toBe(400);
  });

  it('学生 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/folders',
      headers: { cookie: studentCookie },
      payload: { name: '越权' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /banks/folders/:id', () => {
  it('改名成功；改名后与同级重名 409', async () => {
    const id = await createFolder('待改名');
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${id}`,
      headers: { cookie: adminCookie },
      payload: { name: '  已改名  ' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(json<FolderResponse>(renamed).folder.name).toBe('已改名');

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${id}`,
      headers: { cookie: adminCookie },
      payload: { name: '必刷题' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('移动成功（含移到顶层）；移动到自己或子孙 400；父级不存在 400', async () => {
    const p = await createFolder('P');
    const q = await createFolder('Q', p);

    const moveToRoot = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${q}`,
      headers: { cookie: adminCookie },
      payload: { parentId: null },
    });
    expect(moveToRoot.statusCode).toBe(200);
    expect(json<FolderResponse>(moveToRoot).folder.parentId).toBeNull();

    const moveBack = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${q}`,
      headers: { cookie: adminCookie },
      payload: { parentId: p },
    });
    expect(moveBack.statusCode).toBe(200);

    const moveToSelf = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${p}`,
      headers: { cookie: adminCookie },
      payload: { parentId: p },
    });
    expect(moveToSelf.statusCode).toBe(400);

    // p 是 q 的父级：把 p 移到 q 下会成环
    const moveToChild = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${p}`,
      headers: { cookie: adminCookie },
      payload: { parentId: q },
    });
    expect(moveToChild.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(moveToChild).error.message).toContain('子文件夹');

    const missingParent = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${p}`,
      headers: { cookie: adminCookie },
      payload: { parentId: 99999 },
    });
    expect(missingParent.statusCode).toBe(400);
  });

  it('非法 id 400、不存在 404、学生 403', async () => {
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/banks/folders/abc',
      headers: { cookie: adminCookie },
      payload: { name: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/v1/banks/folders/99999',
      headers: { cookie: adminCookie },
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    const student = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/folders/${rootA}`,
      headers: { cookie: studentCookie },
      payload: { name: 'x' },
    });
    expect(student.statusCode).toBe(403);
  });
});

describe('层级保护', () => {
  it('超过 12 层的子孙平铺到第 12 层', async () => {
    let parentId: number | null = null;
    for (let i = 1; i <= 15; i += 1) parentId = await createFolder(`深${i}`, parentId);

    const tree = await getTree();
    const root = tree.folders.find((f) => f.name === '深1');
    expect(root).toBeDefined();
    let node = root!;
    for (let level = 1; level < 11; level += 1) node = node.children[0]!;
    // 第 11 层的「深11」把 深12..深15 全部平铺成直接子级（树最深 12 级）
    expect(node.name).toBe('深11');
    expect(node.children.map((f) => f.name)).toEqual(['深12', '深13', '深14', '深15']);
    expect(node.children.every((f) => f.children.length === 0)).toBe(true);
  });
});

describe('DELETE /banks/folders/:id', () => {
  it('空文件夹可删；有子文件夹或有题库 409', async () => {
    const id = await createFolder('临时空目录');
    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/v1/banks/folders/${id}`,
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect((await getTree()).folders.some((f) => f.id === id)).toBe(false);

    const hasChild = await app.inject({
      method: 'DELETE',
      url: `/api/v1/banks/folders/${rootA}`,
      headers: { cookie: adminCookie },
    });
    expect(hasChild.statusCode).toBe(409);
    expect(json<{ error: { message: string } }>(hasChild).error.message).toBe('请先移走其中的题库或子文件夹');

    const hasBank = await app.inject({
      method: 'DELETE',
      url: `/api/v1/banks/folders/${childB1}`,
      headers: { cookie: adminCookie },
    });
    expect(hasBank.statusCode).toBe(409);
  });

  it('不存在 404、非法 id 400、学生 403', async () => {
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/v1/banks/folders/99999',
      headers: { cookie: adminCookie },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'DELETE',
      url: '/api/v1/banks/folders/abc',
      headers: { cookie: adminCookie },
    });
    expect(bad.statusCode).toBe(400);
    const student = await app.inject({
      method: 'DELETE',
      url: `/api/v1/banks/folders/${empty}`,
      headers: { cookie: studentCookie },
    });
    expect(student.statusCode).toBe(403);
  });
});
