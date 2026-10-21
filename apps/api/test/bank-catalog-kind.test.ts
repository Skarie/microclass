/**
 * 目录接口的题库类型过滤（`GET /banks/catalog?kind=`）：
 *   - 课程列表只统计该类型的题库（题量/章节数同步收窄）；
 *   - 未归属册次只保留确实含有该类型题库的册次；
 *   - 绑定统计与 `/banks?kind=` 的列表总数一致；
 *   - 非法 kind 返回 400。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface CatalogBody {
  courses: { id: number; name: string; bankCount: number; questionCount: number; chapterCount: number }[];
  unbound: { bankCount: number; questionCount: number };
  unboundBooks: { book: string; bankCount: number; questionCount: number }[];
  binding: { bound: number; unbound: number; banks: number };
}

let app: FastifyInstance;
let cookie = '';
let dataDir: string;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function catalog(kind?: string): Promise<CatalogBody> {
  const query = kind === undefined ? '' : `?kind=${encodeURIComponent(kind)}`;
  const res = await app.inject({ method: 'GET', url: `/api/v1/banks/catalog${query}`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return json<CatalogBody>(res);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-catalog-kind-'));
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
  cookie = await login('admin', 'admin123');

  // 课程 1：课时题库 + 章节题库 + 整卷试卷；课程 2：只有章节题库（kind=paper 时应消失）
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['初中数学·八年级下册']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['初中语文·七年级上册']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    '1 二次根式',
    '一 二次根式',
  ]);

  // 1~3 已归属课程 1；4 未归属章节题库；5、6 未归属整卷试卷（6 与 4 同册次）
  const banks: [number, number | null, string, string, string, number | null][] = [
    [1, 1, 'lesson', '1 二次根式', '八年级下册', 1],
    [2, null, 'chapter', '一 二次根式 · 二次根式', '八年级下册', 1],
    [3, null, 'paper', '八年级下册 · 期末测评', '八年级下册', 1],
    [4, null, 'chapter', '八年级下册 · 二次根式 · 专项', '八年级下册', null],
    [5, null, 'paper', '九年级全一册 · 中考模拟', '九年级全一册', null],
    [6, null, 'paper', '八年级下册 · 单元测试', '八年级下册', null],
    [7, null, 'chapter', '七年级上册 · 第一单元 · 专项', '七年级上册', 2],
  ];
  for (const [id, lessonId, kind, name, book, courseId] of banks) {
    db.run('INSERT INTO banks (id, name, lesson_id, kind, subject, book, course_id) VALUES (?,?,?,?,?,?,?)', [
      id,
      name,
      lessonId,
      kind,
      '数学',
      book,
      courseId,
    ]);
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, content_hash)
       VALUES (?, 'fill', ?, '[]', '1', 'easy', ?)`,
      [id, `题库 ${id} 的题`, `kind-hash-${id}`],
    );
  }
  // 原生 SQL 造题绕过了写路径，按运维脚本同样的做法重算一次题库题量（迁移 0019 的预计算列）
  built.deps.questions.fixBankQuestionCounts();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('目录接口按题库类型过滤', () => {
  it('kind=paper：课程目录只统计试卷题库', async () => {
    const res = await catalog('paper');
    // 课程 2 只有章节题库，筛选试卷后整门课都不该出现
    expect(res.courses.map((c) => c.id)).toEqual([1]);
    expect(res.courses[0]).toMatchObject({ id: 1, bankCount: 1, questionCount: 1, chapterCount: 0 });
  });

  it('kind=paper：未归属册次只含试卷', async () => {
    const res = await catalog('paper');
    expect(res.unbound).toMatchObject({ bankCount: 2, questionCount: 2 });
    // 八年级下册同时有章节题库和试卷，筛试卷后只统计试卷（不是 2）
    expect(res.unboundBooks.map((b) => b.book).sort()).toEqual(['九年级全一册', '八年级下册']);
    expect(res.unboundBooks.find((b) => b.book === '八年级下册')).toMatchObject({ bankCount: 1, questionCount: 1 });
    expect(res.unboundBooks.find((b) => b.book === '九年级全一册')).toMatchObject({ bankCount: 1, questionCount: 1 });
  });

  it('kind=paper：绑定统计与题库列表总数一致', async () => {
    const res = await catalog('paper');
    expect(res.binding).toMatchObject({ bound: 1, unbound: 2, banks: 3 });

    const list = json<{ banks: { id: number; kind: string }[]; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?kind=paper&limit=50', headers: { cookie } }),
    );
    expect(list.total).toBe(res.binding.banks);
    expect(list.banks.map((b) => b.id)).toEqual([6, 5, 3]);
    expect(list.banks.every((b) => b.kind === 'paper')).toBe(true);
  });

  it('kind 为空串（全部类型）与不传时一致', async () => {
    const all = await catalog();
    const empty = await catalog('');
    expect(empty.courses).toEqual(all.courses);
    expect(all.courses.map((c) => c.id)).toEqual([1, 2]);
    expect(all.courses.find((c) => c.id === 1)).toMatchObject({ bankCount: 3, questionCount: 3, chapterCount: 1 });
    expect(all.unbound).toMatchObject({ bankCount: 3, questionCount: 3 });
  });

  it('非法 kind 返回 400', async () => {
    for (const url of ['/api/v1/banks/catalog?kind=exam', '/api/v1/banks?kind=exam']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(400);
    }
  });
});
