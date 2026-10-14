/**
 * 组卷选题能力（对齐全主流组卷系统）集成测试：
 *   ① 选题树 facets：册次 → 章节（带题量），计数跟随题型/难度筛选
 *   ② 多选筛选：章节/知识点/题型/难度 IN 查询（不是 LIKE 子串）
 *   ③ 知识点懒加载 /points
 *   ④ 按筛选整批加入试卷（"全选筛选结果 N 题"），服务端取 id
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
let db: Db;
let dataDir: string;
let cookie = '';
let courseId = 0;
let examId = 0;
const ids = new Map<string, number>();

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

/** 造题并写入册次/章节/知识点/难度（建题接口没有这些字段） */
async function addQuestion(
  bankId: number,
  stem: string,
  type: string,
  meta: { book: string; chapter: string; point: string; level: 'easy' | 'medium' | 'hard' },
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    payload: { bankId, type, stem, options: ['A', 'B'], answer: type === 'judge' ? '对' : 'A' },
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  const id = json<{ id: number }>(res).id;
  const score = meta.level === 'easy' ? 30 : meta.level === 'hard' ? 85 : 55;
  db.run('UPDATE questions SET book = ?, chapter = ?, point = ?, difficulty = ?, difficulty_score = ? WHERE id = ?', [
    meta.book,
    meta.chapter,
    meta.point,
    meta.level,
    score,
    id,
  ]);
  ids.set(stem, id);
  return id;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-facets-'));
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
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  const course = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '选题树测试课程', published: true },
    headers: { cookie },
  });
  courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '选题树测试题库', courseId },
    headers: { cookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  // 两个册次 × 两章 × 两个知识点，题型/难度错开
  await addQuestion(bankId, 'A册-第一章-知识点甲-单选易', 'single', {
    book: '一年级下册',
    chapter: '第一章 加与减',
    point: '知识点甲',
    level: 'easy',
  });
  await addQuestion(bankId, 'A册-第一章-知识点甲-单选难', 'single', {
    book: '一年级下册',
    chapter: '第一章 加与减',
    point: '知识点甲',
    level: 'hard',
  });
  await addQuestion(bankId, 'A册-第一章-知识点乙-判断易', 'judge', {
    book: '一年级下册',
    chapter: '第一章 加与减',
    point: '知识点乙',
    level: 'easy',
  });
  await addQuestion(bankId, 'A册-第二章-知识点丙-填空中', 'fill', {
    book: '一年级下册',
    chapter: '第二章 生活中的数',
    point: '知识点丙',
    level: 'medium',
  });
  await addQuestion(bankId, 'B册-第一章-知识点丁-单选易', 'single', {
    book: '二年级上册',
    chapter: '第一章 认识图形',
    point: '知识点丁',
    level: 'easy',
  });

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: '选题树测试考试', durationMinutes: 45, passScore: 60, status: 'draft' },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('选题树 facets（册次 → 章节）', () => {
  it('按册次分组返回章节与题量', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/facets?courseId=${courseId}`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      total: number;
      books: { book: string; count: number; chapters: { chapter: string; count: number }[] }[];
      types: { type: string; count: number }[];
      levels: { level: string; count: number }[];
    }>(res);

    expect(body.total).toBe(5);
    const bookA = body.books.find((b) => b.book === '一年级下册');
    expect(bookA?.count).toBe(4);
    expect(bookA?.chapters.find((c) => c.chapter === '第一章 加与减')?.count).toBe(3);
    expect(bookA?.chapters.find((c) => c.chapter === '第二章 生活中的数')?.count).toBe(1);
    expect(body.books.find((b) => b.book === '二年级上册')?.count).toBe(1);
    // 题型/难度计数
    expect(body.types.find((t) => t.type === 'single')?.count).toBe(3);
    expect(body.levels.find((l) => l.level === 'easy')?.count).toBe(3);
    expect(body.levels.find((l) => l.level === 'hard')?.count).toBe(1);
  });

  it('计数跟随题型筛选变化（老师选完题型就看到每章还剩多少）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/facets?courseId=${courseId}&types=single`,
      headers: { cookie },
    });
    const body = json<{ total: number; books: { book: string; count: number }[] }>(res);
    expect(body.total).toBe(3);
    expect(body.books.find((b) => b.book === '一年级下册')?.count).toBe(2);
  });
});

describe('多选筛选（章节 / 知识点 / 题型 / 难度）', () => {
  it('章节多选是精确匹配（不是 LIKE 子串）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&chapters=第一章 加与减,第二章 生活中的数&pageSize=50`,
      headers: { cookie },
    });
    const body = json<{ total: number; questions: { id: number }[] }>(res);
    expect(body.total).toBe(4); // A 册两章共 4 题
    // 「第一章」这三个字同时也是 B 册「第一章 认识图形」的前缀，精确匹配不能把它带进来
    expect(body.questions.map((q) => q.id)).not.toContain(ids.get('B册-第一章-知识点丁-单选易'));
  });

  it('知识点多选 + 题型 + 难度可组合', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&points=知识点甲,知识点乙&types=single&levels=easy&pageSize=50`,
      headers: { cookie },
    });
    const body = json<{ total: number; questions: { id: number }[] }>(res);
    expect(body.total).toBe(1);
    expect(body.questions[0]?.id).toBe(ids.get('A册-第一章-知识点甲-单选易'));
  });

  it('题量不足时返回 0（不报错）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&points=不存在的知识点&pageSize=20`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ total: number }>(res).total).toBe(0);
  });
});

describe('知识点懒加载', () => {
  it('按章节取知识点清单与题量', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/points?courseId=${courseId}&chapters=第一章 加与减`,
      headers: { cookie },
    });
    const body = json<{ points: { point: string; count: number }[] }>(res);
    expect(body.points.find((p) => p.point === '知识点甲')?.count).toBe(2);
    expect(body.points.find((p) => p.point === '知识点乙')?.count).toBe(1);
    expect(body.points.map((p) => p.point)).not.toContain('知识点丁');
  });

  it('可按知识点关键字搜索', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/points?courseId=${courseId}&pointKeyword=知识点丁`,
      headers: { cookie },
    });
    const body = json<{ points: { point: string; count: number }[] }>(res);
    expect(body.points).toHaveLength(1);
    expect(body.points[0]?.point).toBe('知识点丁');
  });
});

describe('按筛选整批加入（全选筛选结果）', () => {
  it('把筛选出来的题一次加入试卷，并如实报告匹配数', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      payload: { filters: { courseId, books: ['一年级下册'], types: ['single', 'judge'] } },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{ added: number; matched: number }>(res);
    expect(body.matched).toBe(3); // A 册的单选 2 + 判断 1
    expect(body.added).toBe(3);

    const paper = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } });
    expect(json<{ questions: unknown[] }>(paper).questions).toHaveLength(3);
  });

  it('重复加入不会重复计（同一道题只入卷一次）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      payload: { filters: { courseId, books: ['一年级下册'] } },
      headers: { cookie },
    });
    const body = json<{ added: number; matched: number }>(res);
    expect(body.matched).toBe(4);
    expect(body.added).toBe(1); // 只有「第二章 填空」是新的
    const paper = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } });
    expect(json<{ questions: unknown[] }>(paper).questions).toHaveLength(4);
  });

  it('筛选结果为空时给出明确错误，而不是静默成功', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      payload: { filters: { courseId, points: ['根本没有这个知识点'] } },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('没有题目');
  });
});
