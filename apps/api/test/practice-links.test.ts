/**
 * 实践关联（迁移 0025）：一个目标（题库/章节/小节/单题）可关联多个课时；
 * 覆盖 CRUD、重复忽略、question 目标校验、权限与课时练习汇总。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface LessonRef {
  id: number;
  title: string;
  courseId: number | null;
  courseName: string;
  groupName: string;
}

interface LinkDto {
  id: number;
  targetType: string;
  bankId: number;
  questionId: number | null;
  chapter: string;
  section: string;
  lessonIds: number[];
  lessons: LessonRef[];
  createdAt: string;
}

interface PracticeBody {
  lessonId: number;
  banks: { bankId: number; name: string; chapter: string; section: string }[];
  questions: { linkId: number; bankId: number; bankName: string; questionId: number; stem: string }[];
}

let app: FastifyInstance;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';
let bankLinkId = 0;
let chapterLinkId = 0;
let sectionLinkId = 0;
let questionLinkId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function postLink(payload: Record<string, unknown>, cookie = adminCookie): Promise<LinkDto> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/practice-links',
    headers: { cookie },
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ link: LinkDto }>(res).link;
}

async function listLinks(): Promise<LinkDto[]> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/practice-links?bankId=1',
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return json<LinkDto[]>(res);
}

async function practice(lessonId: number, cookie = adminCookie): Promise<PracticeBody> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/lessons/${lessonId}/practice`,
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<PracticeBody>(res);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-practice-links-'));
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
  adminCookie = await login('admin', 'admin123');

  const teacher = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: adminCookie },
    payload: { username: 'link_teacher', password: 'pass1234', role: 'teacher' },
  });
  expect(teacher.statusCode).toBe(200);
  teacherCookie = await login('link_teacher', 'pass1234');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'link_student', password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['初中数学·七年级上册']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, ?, 1, ?, 1)', ['第一课', '第一章']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (2, ?, 1, ?, 2)', ['第二课', '第一章']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (3, ?, 1, ?, 3)', ['第三课', '第二章']);
  db.run('INSERT INTO banks (id, name) VALUES (1, ?)', ['练习题库']);
  db.run('INSERT INTO banks (id, name) VALUES (2, ?)', ['另一题库']);
  db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (1, 1, 'fill', ?)", [
    '![图](/x.png) 计算 $1+1$ 的结果',
  ]);
  db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (2, 2, 'fill', ?)", ['别的题']);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('实践关联 CRUD 与多课时', () => {
  it('POST 整个题库 + 多课时，GET 返回 lessonIds / lessons；重复关联忽略而非报错', async () => {
    const link = await postLink({ targetType: 'bank', bankId: 1, lessonIds: [1, 2] });
    bankLinkId = link.id;
    expect(link).toMatchObject({
      targetType: 'bank',
      bankId: 1,
      questionId: null,
      chapter: '',
      section: '',
      lessonIds: [1, 2],
    });
    expect(link.lessons.map((lesson) => lesson.title)).toEqual(['第一课', '第二课']);
    expect(link.lessons[0]).toMatchObject({ courseId: 1, courseName: '初中数学·七年级上册', groupName: '第一章' });

    const dup = await postLink({ targetType: 'bank', bankId: 1, lessonIds: [2, 3] });
    expect(dup.id).toBe(bankLinkId);
    expect(dup.lessonIds).toEqual([1, 2, 3]);

    const list = await listLinks();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(bankLinkId);
  });

  it('章节 / 小节 / 单题目标都能创建；question 必须属于该题库', async () => {
    const chapter = await postLink({ targetType: 'chapter', bankId: 1, chapter: ' 第一章 ', lessonIds: [1] });
    chapterLinkId = chapter.id;
    expect(chapter).toMatchObject({ targetType: 'chapter', chapter: '第一章', section: '', lessonIds: [1] });

    const section = await postLink({
      targetType: 'section',
      bankId: 1,
      chapter: '第一章',
      section: '1.1',
      lessonIds: [1],
    });
    sectionLinkId = section.id;
    expect(section).toMatchObject({ targetType: 'section', chapter: '第一章', section: '1.1' });

    const question = await postLink({ targetType: 'question', bankId: 1, questionId: 1, lessonIds: [1] });
    questionLinkId = question.id;
    expect(question).toMatchObject({ targetType: 'question', questionId: 1, chapter: '', section: '' });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/practice-links',
      headers: { cookie: adminCookie },
      payload: { targetType: 'question', bankId: 1, questionId: 2, lessonIds: [1] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('参数校验与权限', () => {
  it('缺少章节/小节、空课时数组、不存在的课时都是 400', async () => {
    const cases: Record<string, unknown>[] = [
      { targetType: 'chapter', bankId: 1, lessonIds: [1] },
      { targetType: 'section', bankId: 1, chapter: '第一章', lessonIds: [1] },
      { targetType: 'bank', bankId: 1, lessonIds: [] },
      { targetType: 'bank', bankId: 1, lessonIds: [99999] },
      { targetType: 'nope', bankId: 1, lessonIds: [1] },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/practice-links',
        headers: { cookie: adminCookie },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('读需登录，学生可读，写仅教师/管理员', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/api/v1/practice-links?bankId=1' });
    expect(noAuth.statusCode).toBe(401);

    const studentRead = await app.inject({
      method: 'GET',
      url: '/api/v1/practice-links?bankId=1',
      headers: { cookie: studentCookie },
    });
    expect(studentRead.statusCode).toBe(200);

    const studentWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/practice-links',
      headers: { cookie: studentCookie },
      payload: { targetType: 'bank', bankId: 1, lessonIds: [1] },
    });
    expect(studentWrite.statusCode).toBe(403);

    const teacherLink = await postLink(
      { targetType: 'chapter', bankId: 1, chapter: '教师章', lessonIds: [1] },
      teacherCookie,
    );
    expect(teacherLink.targetType).toBe('chapter');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/practice-links/${teacherLink.id}`,
      headers: { cookie: teacherCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(json<{ ok: boolean }>(del).ok).toBe(true);
  });
});

describe('课时练习汇总', () => {
  it('bank / chapter / section 进 banks，question 进 questions，题干是纯文本前缀', async () => {
    const body = await practice(1);
    expect(body.lessonId).toBe(1);
    expect(body.banks).toEqual([
      { bankId: 1, name: '练习题库', chapter: '', section: '' },
      { bankId: 1, name: '练习题库', chapter: '第一章', section: '' },
      { bankId: 1, name: '练习题库', chapter: '第一章', section: '1.1' },
    ]);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({
      linkId: questionLinkId,
      bankId: 1,
      bankName: '练习题库',
      questionId: 1,
      stem: '计算 $1+1$ 的结果',
    });

    // 第二个课时只挂了整个题库
    const lesson2 = await practice(2);
    expect(lesson2.banks).toEqual([{ bankId: 1, name: '练习题库', chapter: '', section: '' }]);
    expect(lesson2.questions).toEqual([]);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons/99999/practice',
      headers: { cookie: adminCookie },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('学生可读某课时的练习内容', async () => {
    const body = await practice(1, studentCookie);
    expect(body.lessonId).toBe(1);
    expect(body.banks).toHaveLength(3);
    expect(body.questions).toHaveLength(1);
  });
});

describe('改课时与删除', () => {
  it('PATCH 覆盖式设置课时；空数组 400；DELETE 后列表减少', async () => {
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/practice-links/${bankLinkId}`,
      headers: { cookie: adminCookie },
      payload: { lessonIds: [2, 3] },
    });
    expect(patched.statusCode).toBe(200);
    expect(json<{ link: LinkDto }>(patched).link.lessonIds).toEqual([2, 3]);

    const empty = await app.inject({
      method: 'PATCH',
      url: `/api/v1/practice-links/${bankLinkId}`,
      headers: { cookie: adminCookie },
      payload: { lessonIds: [] },
    });
    expect(empty.statusCode).toBe(400);

    const before = await listLinks();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/practice-links/${chapterLinkId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(json<{ ok: boolean }>(del).ok).toBe(true);
    expect((await listLinks()).length).toBe(before.length - 1);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/practice-links/${chapterLinkId}`,
      headers: { cookie: adminCookie },
    });
    expect(again.statusCode).toBe(404);

    // 清理：确认 section / question 关联仍在，避免后续用例互相影响
    expect((await listLinks()).map((link) => link.id)).toContain(sectionLinkId);
    expect((await listLinks()).map((link) => link.id)).toContain(questionLinkId);
  });
});
