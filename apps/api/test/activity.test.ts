import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 学习日历：`GET /me/activity?days=`
 *
 * 夹具直接写 lesson_progress / attempts（活动时间可控），覆盖：
 * 只返有活动的日期、lessons 去重计数、quizzes 计数、days 边界、用户隔离。
 */
let app: FastifyInstance;
let built: BuiltApp;
let dataDir: string;
let adminCookie = '';
let studentCookie = '';
let otherCookie = '';

const DAY = 86_400;
const base = Math.floor(Date.now() / 1000);
const today = base;
const twoDaysAgo = base - 2 * DAY;
const tenDaysAgo = base - 10 * DAY;
const fortyDaysAgo = base - 40 * DAY;
const lessonIds: number[] = [];

interface ActivityDay {
  date: string;
  lessons: number;
  quizzes: number;
  active: boolean;
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

/** 服务器本地日期（与接口口径一致） */
function localDate(ts: number): string {
  const d = new Date(ts * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

async function createLesson(courseId: number, title: string): Promise<number> {
  return json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title, courseId, videoKind: 'url', videoPath: 'https://example.com/v.mp4' },
    }),
  ).id;
}

function insertProgress(userId: number, lessonId: number, updatedAt: number): void {
  built.deps.db.run(
    'INSERT INTO lesson_progress (user_id, lesson_id, position, duration, updated_at) VALUES (?,?,0,0,?)',
    [userId, lessonId, updatedAt],
  );
}

function insertAttempt(userId: number, lessonId: number, createdAt: number): void {
  built.deps.db.run("INSERT INTO attempts (client_id, user_id, lesson_id, created_at) VALUES ('act',?,?,?)", [
    userId,
    lessonId,
    createdAt,
  ]);
}

async function activity(cookie: string, query = ''): Promise<ActivityDay[]> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/me/activity${query}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<{ days: ActivityDay[] }>(res).days;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-activity-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
  });
  built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();

  adminCookie = cookieOf(
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    }),
  );
  const courseId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '日历课程', published: true },
    }),
  ).id;
  for (const title of ['课时1', '课时2', '课时3', '课时4', '课时5']) {
    lessonIds.push(await createLesson(courseId, title));
  }

  const student = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `act_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = cookieOf(student);
  const studentId = json<{ user: { id: number } }>(student).user.id;

  const other = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `act_other_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  otherCookie = cookieOf(other);
  const otherId = json<{ user: { id: number } }>(other).user.id;

  const [l1, l2, l3, l4, l5] = lessonIds;
  if (l1 === undefined || l2 === undefined || l3 === undefined || l4 === undefined || l5 === undefined) {
    throw new Error('课时夹具创建失败');
  }
  insertProgress(studentId, l1, today);
  insertProgress(studentId, l2, today);
  insertProgress(studentId, l3, twoDaysAgo);
  insertProgress(studentId, l4, tenDaysAgo);
  insertProgress(studentId, l5, fortyDaysAgo);
  insertAttempt(studentId, l1, today);
  insertAttempt(studentId, l1, today);
  insertAttempt(studentId, l3, twoDaysAgo);
  insertAttempt(studentId, l4, tenDaysAgo);
  insertAttempt(studentId, l5, fortyDaysAgo);

  insertProgress(otherId, l1, today);
  insertAttempt(otherId, l1, today);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/v1/me/activity', () => {
  it('默认 days=30：只返有活动的日期，按日期升序，lessons/quizzes 计数正确', async () => {
    const days = await activity(studentCookie);
    expect(days.map((d) => d.date)).toEqual([localDate(tenDaysAgo), localDate(twoDaysAgo), localDate(today)]);
    expect(days.every((d) => d.active)).toBe(true);
    expect(days.find((d) => d.date === localDate(today))).toEqual({
      date: localDate(today),
      lessons: 2,
      quizzes: 2,
      active: true,
    });
    expect(days.find((d) => d.date === localDate(twoDaysAgo))).toEqual({
      date: localDate(twoDaysAgo),
      lessons: 1,
      quizzes: 1,
      active: true,
    });
    expect(days.find((d) => d.date === localDate(tenDaysAgo))).toEqual({
      date: localDate(tenDaysAgo),
      lessons: 1,
      quizzes: 1,
      active: true,
    });
    for (const d of days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('days=1 只含今天；days=7 排除 10 天前；days=90 含 40 天前', async () => {
    expect((await activity(studentCookie, '?days=1')).map((d) => d.date)).toEqual([localDate(today)]);
    expect((await activity(studentCookie, '?days=7')).map((d) => d.date)).toEqual([
      localDate(twoDaysAgo),
      localDate(today),
    ]);
    expect((await activity(studentCookie, '?days=90')).map((d) => d.date)).toEqual([
      localDate(fortyDaysAgo),
      localDate(tenDaysAgo),
      localDate(twoDaysAgo),
      localDate(today),
    ]);
  });

  it('days 缺省与显式 30 一致；空串按缺省处理', async () => {
    const explicit = await activity(studentCookie, '?days=30');
    const empty = await activity(studentCookie, '?days=');
    expect(empty).toEqual(explicit);
  });

  it.each(['0', '91', 'abc', '1.5', '-1'])('非法 days=%s 返回 400', async (days) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/me/activity?days=${days}`,
      headers: { cookie: studentCookie },
    });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('BAD_REQUEST');
  });

  it('用户隔离：只看自己的活动', async () => {
    const days = await activity(otherCookie);
    expect(days).toEqual([{ date: localDate(today), lessons: 1, quizzes: 1, active: true }]);
  });

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/activity' });
    expect(res.statusCode).toBe(401);
  });
});
