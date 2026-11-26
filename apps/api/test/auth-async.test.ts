import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { hashPassword, newSalt } from '../src/security/password.js';

/**
 * users / auth 域异步化后的鉴权链路回归。
 *
 * 重点不是「接口通不通」，而是 **Promise 有没有漏 await**：
 * 仓储一旦返回 Promise 而调用点没 await，`req.authUser` 会变成一个对象形状错误的 Promise，
 * 表现为「已登录却全是 401」或「403 判定取不到 role」。tsc 对 `reply.send(Promise)` 完全不报错，
 * 所以这里用「登录后立刻用同一 cookie 打受保护接口」的方式把整条链路钉住。
 */
let built: BuiltApp;
let app: FastifyInstance;
let dataDir: string;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-auth-async-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();
  // 管理员直接建一个学生：走 authService.createUserByAdmin（内部已 await 仓储）
  const adminCookie = await login('admin', 'admin123');
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: adminCookie },
    payload: { username: 'asstud1', password: 'stud12345', role: 'student', displayName: '异步学生' },
  });
  expect(created.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('users/auth 异步仓储契约', () => {
  it('所有仓储方法返回 Promise，await 之后才是行数据', async () => {
    const salt = newSalt();
    const created = built.deps.users.create({
      username: 'contract-user',
      salt,
      hash: hashPassword('pass12345', salt),
      role: 'student',
    });
    // 未 await 时是 Promise：这正是「把 Promise 当 user 用」的根源
    expect(created).toBeInstanceOf(Promise);
    const id = await created;
    expect(typeof id).toBe('number');

    const byId = built.deps.users.findById(id);
    expect(byId).toBeInstanceOf(Promise);
    const row = await byId;
    expect(row?.username).toBe('contract-user');
    expect(row?.pass_hash).toBe(hashPassword('pass12345', salt));

    expect(built.deps.users.findByUsername('contract-user')).toBeInstanceOf(Promise);
    expect(built.deps.users.count()).toBeInstanceOf(Promise);
    expect(built.deps.users.listStudents()).toBeInstanceOf(Promise);
    expect(await built.deps.users.count()).toBeGreaterThanOrEqual(2);
  });

  it('会话中间件 await 了 findById：登录后 /me 立刻能解析出完整用户', async () => {
    const cookie = await login('asstud1', 'stud12345');
    expect(cookie).not.toBe('');

    const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { user } = json<{ user: { id: number; username: string; role: string } }>(res);
    // 如果 guards 里漏了 await，user 会是 Promise 序列化后的 `{}` 或字段缺失
    expect(typeof user.id).toBe('number');
    expect(user.username).toBe('asstud1');
    expect(user.role).toBe('student');

    // 同一 cookie 打多个受保护接口都应稳定 200（会话解析不是一次性的偶然）
    for (const url of ['/api/v1/courses', '/api/v1/meta', '/api/v1/me']) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(r.statusCode).toBe(200);
    }
  });

  it('401 / 403 仍是错误信封（不是 Promise 序列化成 {}）', async () => {
    const noCookie = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(noCookie.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(noCookie).error.code).toBe('UNAUTHORIZED');

    const studentCookie = await login('asstud1', 'stud12345');
    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: studentCookie } });
    expect(forbidden.statusCode).toBe(403);
    const body = json<{ error: { code: string; message: string } }>(forbidden);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message.length).toBeGreaterThan(0);

    // 管理员同接口应 200 且能看到学生列表（同一 preValidation 路径，角色判定生效）
    const adminCookie = await login('admin', 'admin123');
    const list = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie: adminCookie } });
    expect(list.statusCode).toBe(200);
    const users = json<{ users: { username: string; role: string }[] }>(list).users;
    expect(users.some((u) => u.username === 'asstud1')).toBe(true);
    expect(users.every((u) => u.role === 'student')).toBe(true);
  });

  it('改密（异步 updatePassword）立即生效：旧密码 401、新密码可登录', async () => {
    const cookie = await login('asstud1', 'stud12345');
    const changed = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/password',
      headers: { cookie },
      payload: { oldPassword: 'stud12345', newPassword: 'stud54321' },
    });
    expect(changed.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'asstud1', password: 'stud12345' },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'asstud1', password: 'stud54321' },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(json<{ user: { username: string } }>(newLogin).user.username).toBe('asstud1');
  });
});
