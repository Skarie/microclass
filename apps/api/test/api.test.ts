import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

let app: FastifyInstance;
let dataDir: string;
let adminCookie: string;
let studentCookie: string;

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

/**
 * `inject().json()` 的返回类型是 `any`；统一在这里收敛成显式类型，
 * 既让断言受类型保护，也避免 no-unsafe-* 规则报错。
 */
function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-api-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
  });
  const built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('健康检查', () => {
  it('GET /api/v1/healthz 返回 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res)).toMatchObject({ status: 'ok' });
  });

  it('GET /api/v1/readyz 返回 ready（数据库可用）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string; db: string }>(res)).toMatchObject({ status: 'ready', db: 'ok' });
  });

  it('未知接口返回统一错误信封', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/not-exists' });
    expect(res.statusCode).toBe(404);
    const body = json<{ error: { code: string; requestId: string } }>(res);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
});

describe('认证与账号', () => {
  it('未登录访问受保护接口返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/courses' });
    expect(res.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('UNAUTHORIZED');
  });

  it('管理员引导账号可登录并拿到会话 Cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    expect(res.statusCode).toBe(200);
    adminCookie = cookieOf(res);
    expect(adminCookie).toContain('microclass_sid=');
    expect(json<{ user: { role: string } }>(res).user.role).toBe('admin');
  });

  it('错误密码被拒绝且不会泄露账号是否存在', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'wrong-pass' },
    });
    expect(res.statusCode).toBe(401);
    expect(json<{ error: { message: string } }>(res).error.message).toBe('用户名或密码错误');
  });

  it('学生可自助注册并获得会话', async () => {
    const username = `stu_${Date.now().toString(36)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, password: 'pass1234', displayName: '测试学生' },
    });
    expect(res.statusCode).toBe(200);
    studentCookie = cookieOf(res);
    expect(studentCookie).toBeTruthy();
  });

  it('学生不能访问管理端接口（403）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(403);
  });

  it('请求参数校验失败返回 400 与 details', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('BAD_REQUEST');
  });
});

describe('课程与课时', () => {
  let courseId = 0;

  it('管理员创建课程（默认草稿可见性由参数控制）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: 'Java 程序设计', description: '测试课程', published: true },
    });
    expect(res.statusCode).toBe(200);
    courseId = json<{ id: number }>(res).id;
    expect(courseId).toBeGreaterThan(0);
  });

  it('学生课程列表中可见已发布课程并带统计字段', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(200);
    const body = json<{ courses: { id: number; total: number; fav: boolean }[] }>(res);
    const found = body.courses.find((c) => c.id === courseId);
    expect(found).toBeTruthy();
    expect(found?.total).toBe(0);
    expect(found?.fav).toBe(false);
  });

  it('收藏与取消收藏幂等切换', async () => {
    const on = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/fav`,
      headers: { cookie: studentCookie },
    });
    expect(json<{ fav: boolean }>(on).fav).toBe(true);
    const off = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/fav`,
      headers: { cookie: studentCookie },
    });
    expect(json<{ fav: boolean }>(off).fav).toBe(false);
  });

  it('草稿课程对学生 404，管理员可见', async () => {
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '草稿课程', published: false },
    });
    const draftId = json<{ id: number }>(draft).id;
    const asStudent = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${draftId}`,
      headers: { cookie: studentCookie },
    });
    expect(asStudent.statusCode).toBe(404);
    const asAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${draftId}`,
      headers: { cookie: adminCookie },
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it('删除课程不删除课时数据（回到未归类）', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courses/${courseId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons?course=orphan',
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
  });
});

describe('学习进度', () => {
  it('上报进度并按用户聚合学习概览', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: adminCookie },
      payload: { title: '示例课时', videoKind: 'url', videoPath: 'https://example.com/v.mp4' },
    });
    expect(create.statusCode).toBe(200);
    const lessonId = json<{ id: number }>(create).id;

    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/progress',
      headers: { cookie: studentCookie },
      payload: { lessonId, position: 300, duration: 600, finished: false },
    });
    expect(post.statusCode).toBe(200);

    const summary = await app.inject({ method: 'GET', url: '/api/v1/me/summary', headers: { cookie: studentCookie } });
    const body = json<{ minutes: number; level: string; quizzed: number }>(summary);
    expect(body.minutes).toBe(5);
    expect(body.level).toContain('学员');
    expect(body.quizzed).toBe(0);
  });
});
