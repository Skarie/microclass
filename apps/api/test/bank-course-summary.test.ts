/**
 * GET /banks/course-summary：课程关联视图的汇总（只返回有题库的课程，按 name/id 排序）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface CourseSummaryRow {
  courseId: number;
  name: string;
  bankCount: number;
  questionCount: number;
}

interface CourseSummary {
  courses: CourseSummaryRow[];
  unbound: { bankCount: number; questionCount: number };
}

let app: FastifyInstance;
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

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-course-summary-'));
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
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  db.run('INSERT INTO courses (id, name) VALUES (10, ?)', ['A-java']);
  db.run('INSERT INTO courses (id, name) VALUES (11, ?)', ['B-语文']);
  db.run('INSERT INTO courses (id, name) VALUES (12, ?)', ['C-空课程']);

  const banks: [string, number | null, number][] = [
    ['课程 10 题库 1', 10, 5],
    ['课程 10 题库 2', 10, 7],
    ['课程 11 题库', 11, 11],
    ['未关联 1', null, 13],
    ['未关联 2', null, 17],
  ];
  for (const [name, courseId, questionCount] of banks) {
    db.run('INSERT INTO banks (name, kind, course_id, question_count) VALUES (?,?,?,?)', [
      name,
      'lesson',
      courseId,
      questionCount,
    ]);
  }
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /banks/course-summary', () => {
  it('只返回有题库的课程，计数按课程聚合，按 name/id 排序', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/course-summary',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<CourseSummary>(res);

    expect(body.courses).toEqual([
      { courseId: 10, name: 'A-java', bankCount: 2, questionCount: 12 },
      { courseId: 11, name: 'B-语文', bankCount: 1, questionCount: 11 },
    ]);
    // 没有题库的课程（12）不出现在列表里
    expect(body.courses.some((c) => c.courseId === 12)).toBe(false);
    expect(body.unbound).toEqual({ bankCount: 2, questionCount: 30 });
  });

  it('登录可读；未登录 401', async () => {
    const asStudent = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/course-summary',
      headers: { cookie: studentCookie },
    });
    expect(asStudent.statusCode).toBe(200);
    const anon = await app.inject({ method: 'GET', url: '/api/v1/banks/course-summary' });
    expect(anon.statusCode).toBe(401);
  });
});
