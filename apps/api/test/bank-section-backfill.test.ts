/**
 * POST /banks/backfill-sections：给 section 为空的历史题库补章节。
 * 覆盖：dryRun 不写库、kind 过滤、课时 group_name 优先、题库名解析、跳过样本与幂等。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { hashPassword, newSalt } from '../src/security/password.js';
import { backfillSectionOf } from '../src/services/bankSectionService.js';

interface BackfillResult {
  dryRun: boolean;
  filled: number;
  skipped: number;
  samples: { id: number; name: string; section: string }[];
  skippedSamples: { id: number; name: string }[];
}

let app: FastifyInstance;
let db: Db;
let deps: Awaited<ReturnType<typeof buildApp>>['deps'];
let dataDir: string;
let cookie = '';
let studentCookie = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function backfill(payload: Record<string, unknown>, as = cookie): Promise<BackfillResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/banks/backfill-sections',
    headers: { cookie: as },
    payload,
  });
  expect(res.statusCode).toBe(200);
  return json<BackfillResult>(res);
}

function sectionOf(id: number): string | undefined {
  return db.get<{ section: string }>('SELECT section FROM banks WHERE id = ?', [id])?.section;
}

function seedBank(
  id: number,
  name: string,
  kind: string,
  lessonId: number | null,
  section: string,
  courseId: number | null = null,
): void {
  db.run('INSERT INTO banks (id, name, kind, lesson_id, section, course_id, subject, book) VALUES (?,?,?,?,?,?,?,?)', [
    id,
    name,
    kind,
    lessonId,
    section,
    courseId,
    '数学',
    '三年级上册',
  ]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-section-backfill-'));
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
  deps = built.deps;
  await app.ready();
  cookie = await login('admin', 'admin123');
  const salt = newSalt();
  deps.users.create({ username: 's1', salt, hash: hashPassword('stud12345', salt), role: 'student' });
  studentCookie = await login('s1', 'stud12345');

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['小学数学·三年级上册（新）']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', [
    '1 集合',
    '第一章 集合',
  ]);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (2, ?, 1, ?, 2)', ['2 函数', '']);

  // ① 课时 group_name 优先（题库名第一段「课时库」不像章节）
  seedBank(1, '课时库 · 子集', 'lesson', 1, '', 1);
  // ② 无课时 → 解析题库名第一段
  seedBank(2, '第二章 函数 · 定义域', 'chapter', null, '', 1);
  // ③ 第一段是册次 → 跳过
  seedBank(3, '三年级上册 · 第一章 分数', 'chapter', null, '', 1);
  // ④ 完全无法解析 → 跳过
  seedBank(4, '未归类题库', 'paper', null, '', null);
  // ⑤ 课时存在但 group_name 为空 → 继续走题库名解析
  seedBank(5, '1. 集合的含义 · 习题', 'lesson', 2, '', 1);
  // ⑥ 已有章节，不在回填范围内
  seedBank(6, '第一章 集合 · 习题', 'lesson', 1, '第一章 集合', 1);
  // ⑦⑧ 供 kind 过滤使用
  seedBank(7, '第一章 集合 · 期末卷', 'paper', null, '', 1);
  seedBank(8, '第二章 函数 · 单元卷', 'chapter', null, '', 1);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('回填章节：dryRun 与过滤', () => {
  it('dryRun 只预览不写库，samples / skippedSamples 如实返回', async () => {
    const res = await backfill({ dryRun: true });
    expect(res).toMatchObject({ dryRun: true, filled: 5, skipped: 2 });
    expect(res.samples.map((s) => s.id)).toEqual([1, 2, 5, 7, 8]);
    expect(res.samples[0]).toEqual({ id: 1, name: '课时库 · 子集', section: '第一章 集合' });
    expect(res.samples[1]).toEqual({ id: 2, name: '第二章 函数 · 定义域', section: '第二章 函数' });
    expect(res.skippedSamples).toEqual([
      { id: 3, name: '三年级上册 · 第一章 分数' },
      { id: 4, name: '未归类题库' },
    ]);
    for (const id of [1, 2, 5, 7, 8]) expect(sectionOf(id)).toBe('');
  });

  it('kind 过滤只回填对应类型', async () => {
    const res = await backfill({ dryRun: true, kind: 'paper' });
    // paper 类型有两个待回填：#4 无法解析（跳过）、#7 可解析
    expect(res).toMatchObject({ dryRun: true, filled: 1, skipped: 1 });
    expect(res.samples.map((s) => s.id)).toEqual([7]);
    expect(res.skippedSamples.map((s) => s.id)).toEqual([4]);
    expect(sectionOf(7)).toBe('');
  });
});

describe('回填章节：真实写入', () => {
  it('课时继承优先，其次题库名解析，解析不出的跳过', async () => {
    const res = await backfill({});
    expect(res).toMatchObject({ dryRun: false, filled: 5, skipped: 2 });
    expect(sectionOf(1)).toBe('第一章 集合');
    expect(sectionOf(2)).toBe('第二章 函数');
    expect(sectionOf(3)).toBe('');
    expect(sectionOf(4)).toBe('');
    expect(sectionOf(5)).toBe('1. 集合的含义');
    expect(sectionOf(6)).toBe('第一章 集合');
    expect(sectionOf(7)).toBe('第一章 集合');
    expect(sectionOf(8)).toBe('第二章 函数');
  });

  it('再次执行幂等（只剩无法解析的题库，不再写入）', async () => {
    const res = await backfill({});
    expect(res).toMatchObject({ dryRun: false, filled: 0, skipped: 2 });
    expect(res.samples).toEqual([]);
    expect(res.skippedSamples.map((s) => s.id)).toEqual([3, 4]);
    for (const id of [3, 4]) expect(sectionOf(id)).toBe('');
  });

  it('body 可以省略（默认 dryRun=false、kind=全部）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/backfill-sections',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(json<BackfillResult>(res)).toMatchObject({ dryRun: false, filled: 0, skipped: 2 });
  });

  it('权限：学生不能回填，未登录拒绝', async () => {
    const student = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/backfill-sections',
      headers: { cookie: studentCookie },
      payload: { dryRun: true },
    });
    expect(student.statusCode).toBe(403);
    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/banks/backfill-sections',
      payload: { dryRun: true },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('题库名解析章节的规则', () => {
  it('支持第…章/单元/讲、一、、1.、模块…', () => {
    expect(backfillSectionOf({ name: '第一章 集合 · 子集', groupName: '' })).toBe('第一章 集合');
    expect(backfillSectionOf({ name: '第二单元 位置 · 习题', groupName: '' })).toBe('第二单元 位置');
    expect(backfillSectionOf({ name: '第三讲 函数 · 习题', groupName: '' })).toBe('第三讲 函数');
    expect(backfillSectionOf({ name: '一、准备课 · 习题', groupName: '' })).toBe('一、准备课');
    expect(backfillSectionOf({ name: '12. 复习 · 习题', groupName: '' })).toBe('12. 复习');
    expect(backfillSectionOf({ name: '模块一 数与式 · 练习', groupName: '' })).toBe('模块一 数与式');
    expect(backfillSectionOf({ name: '三年级上册 · 第一章 分数', groupName: '' })).toBe('');
    expect(backfillSectionOf({ name: '未归类题库', groupName: '' })).toBe('');
  });

  it('课时 group_name 优先于题库名', () => {
    expect(backfillSectionOf({ name: '第一章 集合 · 子集', groupName: '  第三章 函数  ' })).toBe('第三章 函数');
  });
});
