import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 站内公告：公开列表（只出已发布、置顶优先、时间倒序）、管理端 CRUD、
 * 权限（仅 admin）与入参校验、审计落库。
 */
let app: FastifyInstance;
let built: BuiltApp;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';

interface PublicAnnouncement {
  id: number;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  createdAt: string;
}

interface AdminAnnouncement extends PublicAnnouncement {
  published: boolean;
  createdBy: number | null;
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return cookieOf(res);
}

async function createAnnouncement(payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/announcements',
    headers: { cookie: adminCookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return json<{ id: number }>(res).id;
}

function setCreatedAt(id: number, at: string): void {
  built.deps.db.run('UPDATE announcements SET created_at = ? WHERE id = ?', [at, id]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-announce-'));
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

  adminCookie = await login('admin', 'admin123');
  await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: { cookie: adminCookie },
    payload: { username: 'teacher1', password: 'pass1234', role: 'teacher', displayName: '张老师' },
  });
  teacherCookie = await login('teacher1', 'pass1234');
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: `ann_stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = cookieOf(reg);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/v1/announcements（公开列表）', () => {
  it('只返回已发布，置顶优先、时间倒序', async () => {
    const a = await createAnnouncement({ title: '普通公告 A', body: 'a', level: 'info' });
    const b = await createAnnouncement({ title: '置顶公告 B', body: 'b', level: 'warning', pinned: true });
    await createAnnouncement({ title: '草稿 C', body: 'c', published: false });
    const d = await createAnnouncement({ title: '普通公告 D', body: 'd', level: 'danger' });
    setCreatedAt(a, '2026-11-01 00:00:00');
    setCreatedAt(b, '2026-11-03 00:00:00');
    setCreatedAt(d, '2026-11-04 00:00:00');

    const res = await app.inject({ method: 'GET', url: '/api/v1/announcements', headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(200);
    const list = json<{ announcements: PublicAnnouncement[] }>(res).announcements;
    expect(list.map((x) => x.title)).toEqual(['置顶公告 B', '普通公告 D', '普通公告 A']);
    expect(list[0]).toMatchObject({ pinned: true, level: 'warning', body: 'b', createdAt: '2026-11-03 00:00:00' });
  });

  it('limit 限制条数；非法 limit 返回 400', async () => {
    const one = await app.inject({
      method: 'GET',
      url: '/api/v1/announcements?limit=1',
      headers: { cookie: studentCookie },
    });
    expect(json<{ announcements: PublicAnnouncement[] }>(one).announcements).toHaveLength(1);

    for (const limit of ['0', '51', 'abc', '1.5', '-1']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/announcements?limit=${limit}`,
        headers: { cookie: studentCookie },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('未登录返回 401；教师和学生可读', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/announcements' })).statusCode).toBe(401);
    for (const cookie of [teacherCookie, studentCookie]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/announcements', headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('管理端公告 CRUD', () => {
  it('GET /admin/announcements 返回全部（含未发布）与总数', async () => {
    const before = json<{ total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/admin/announcements', headers: { cookie: adminCookie } }),
    ).total;
    const id = await createAnnouncement({ title: '未发布草稿', body: 'hidden', published: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/announcements?limit=100',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const page = json<{ announcements: AdminAnnouncement[]; total: number; limit: number; offset: number }>(res);
    expect(page.total).toBe(before + 1);
    expect(page.limit).toBe(100);
    expect(page.offset).toBe(0);
    const draft = page.announcements.find((x) => x.id === id);
    expect(draft).toMatchObject({ published: false, body: 'hidden' });

    // 不带分页参数时返回全部（管理端列表没有分页 UI）
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/announcements',
      headers: { cookie: adminCookie },
    });
    const unpaged = json<{ announcements: AdminAnnouncement[]; total: number; limit: number | null }>(all);
    expect(unpaged.limit).toBeNull();
    expect(unpaged.announcements).toHaveLength(unpaged.total);
  });

  it('POST 201 并落审计；默认值 body=""、level=info、pinned=false、published=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/announcements',
      headers: { cookie: adminCookie },
      payload: { title: '默认值公告' },
    });
    expect(res.statusCode).toBe(201);
    const { ok, id } = json<{ ok: boolean; id: number }>(res);
    expect(ok).toBe(true);

    const row = built.deps.db.get<{
      body: string;
      level: string;
      pinned: number;
      published: number;
      created_by: number;
    }>('SELECT body, level, pinned, published, created_by FROM announcements WHERE id = ?', [id]);
    expect(row).toMatchObject({ body: '', level: 'info', pinned: 0, published: 1 });

    const audit = built.deps.db.get<{ action: string; actor_id: number }>(
      "SELECT action, actor_id FROM audit_logs WHERE action = 'announcement.create' AND target_id = ?",
      [String(id)],
    );
    expect(audit?.action).toBe('announcement.create');
  });

  it('POST 校验 title 1..200、body ≤5000、level 枚举、布尔字段', async () => {
    const invalid: Record<string, unknown>[] = [
      {},
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { title: 'ok', body: 'y'.repeat(5001) },
      { title: 'ok', level: 'critical' },
      { title: 'ok', pinned: 'yes' },
      { title: 'ok', published: 'no' },
    ];
    for (const payload of invalid) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/announcements',
        headers: { cookie: adminCookie },
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(json<{ error: { code: string } }>(res).error.code).toBe('BAD_REQUEST');
    }
  });

  it('PUT 部分更新生效并落审计', async () => {
    const id = await createAnnouncement({ title: '待改公告', body: 'old', level: 'info' });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/announcements/${id}`,
      headers: { cookie: adminCookie },
      payload: { title: '改过的公告', level: 'danger', pinned: true, published: false },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ ok: boolean }>(res).ok).toBe(true);

    const row = built.deps.db.get<{ title: string; body: string; level: string; pinned: number; published: number }>(
      'SELECT title, body, level, pinned, published FROM announcements WHERE id = ?',
      [id],
    );
    expect(row).toEqual({ title: '改过的公告', body: 'old', level: 'danger', pinned: 1, published: 0 });
    const audit = built.deps.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'announcement.update' AND target_id = ?",
      [String(id)],
    );
    expect(Number(audit?.c)).toBe(1);
  });

  it('PUT / DELETE 不存在返回 404，非法 id 返回 400', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      const missing = await app.inject({
        method,
        url: '/api/v1/admin/announcements/999999',
        headers: { cookie: adminCookie },
        ...(method === 'PUT' ? { payload: { title: 'x' } } : {}),
      });
      expect(missing.statusCode).toBe(404);

      const invalid = await app.inject({
        method,
        url: '/api/v1/admin/announcements/abc',
        headers: { cookie: adminCookie },
        ...(method === 'PUT' ? { payload: { title: 'x' } } : {}),
      });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it('DELETE 后不可再查，重复删除 404', async () => {
    const id = await createAnnouncement({ title: '待删除公告' });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/announcements/${id}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/announcements/${id}`,
      headers: { cookie: adminCookie },
    });
    expect(again.statusCode).toBe(404);
    const list = json<{ announcements: PublicAnnouncement[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/announcements', headers: { cookie: adminCookie } }),
    ).announcements;
    expect(list.some((x) => x.id === id)).toBe(false);
  });

  it('非管理员（教师/学生）访问管理端返回 403', async () => {
    for (const cookie of [teacherCookie, studentCookie]) {
      const get = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/announcements',
        headers: { cookie },
      });
      expect(get.statusCode).toBe(403);
      const post = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/announcements',
        headers: { cookie },
        payload: { title: '越权公告' },
      });
      expect(post.statusCode).toBe(403);
    }
  });
});
