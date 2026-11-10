import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 题组 / 变式关联 API（迁移 0029）：
 * 组的 CRUD、批量加入（去重 / 角色更新 / 50 题上限）、组内顺序（母题在前）、
 * 移出、级联删除、题目 → 所属题组、题库列表按题组筛选、权限（学员只读）与边界校验。
 *
 * 题目与题库直接写库（只需要 id / stem / type / difficulty 四列），
 * 组与成员关系全部走 HTTP，覆盖真实路由、schema 与服务层校验。
 */
let app: FastifyInstance;
let built: BuiltApp;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';

interface GroupItem {
  id: number;
  title: string;
  note: string;
  roleCounts: { stem: number; variant: number };
  total: number;
  updatedAt: string;
}

interface GroupDetail extends GroupItem {
  questions: { id: number; stem: string; type: string; difficulty: string; role: 'stem' | 'variant'; sort: number }[];
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

async function createGroup(title: string, note?: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/question-groups',
    headers: { cookie: adminCookie },
    payload: note === undefined ? { title } : { title, note },
  });
  expect(res.statusCode).toBe(201);
  return json<{ ok: boolean; id: number }>(res).id;
}

async function addItems(groupId: number, questionIds: number[], role: 'stem' | 'variant'): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/question-groups/${groupId}/items`,
    headers: { cookie: adminCookie },
    payload: { questionIds, role },
  });
  expect(res.statusCode).toBe(200);
}

async function detailOf(groupId: number): Promise<GroupDetail> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/question-groups/${groupId}`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return json<GroupDetail>(res);
}

/** 造一道题；bankId 固定 1，题量少、只关心关系表 */
function seedQuestion(id: number, stem: string): void {
  built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (?, 1, 'fill', ?)", [id, stem]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-question-groups-'));
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
    payload: { username: `qg_stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = cookieOf(reg);

  built.deps.db.run("INSERT INTO banks (id, name) VALUES (1, '七年级数学必刷题')");
  built.deps.db.run("INSERT INTO banks (id, name) VALUES (2, '别的题库')");
  for (let i = 1; i <= 60; i += 1) seedQuestion(i, `第 ${i} 题的题干`);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题组 CRUD', () => {
  it('新建返回 201 与 id，列表带角色计数，改标题与备注生效', async () => {
    const id = await createGroup('一次函数 · 母题与变式', '同一考点的三种问法');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    const groups = json<{ groups: GroupItem[] }>(list).groups;
    const created = groups.find((g) => g.id === id);
    expect(created).toBeDefined();
    expect(created?.title).toBe('一次函数 · 母题与变式');
    expect(created?.note).toBe('同一考点的三种问法');
    expect(created?.roleCounts).toEqual({ stem: 0, variant: 0 });
    expect(created?.total).toBe(0);
    expect(created?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/question-groups/${id}`,
      headers: { cookie: teacherCookie },
      payload: { title: '一次函数（改）' },
    });
    expect(put.statusCode).toBe(200);
    // 只改标题：备注保持原值
    expect((await detailOf(id)).note).toBe('同一考点的三种问法');
    expect((await detailOf(id)).title).toBe('一次函数（改）');
  });

  it('标题为空 / 超长 / 备注超长都拒绝', async () => {
    const blank = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { title: '   ' },
    });
    expect(blank.statusCode).toBe(400);

    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { title: 'x'.repeat(101) },
    });
    expect(tooLong.statusCode).toBe(400);

    const noteTooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { title: '正常标题', note: 'y'.repeat(2001) },
    });
    expect(noteTooLong.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { note: '没有标题' },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('不存在的题组读 / 改 / 删都返回 404，id 非法返回 400', async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups/9999',
      headers: { cookie: adminCookie },
    });
    expect(read.statusCode).toBe(404);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/question-groups/9999',
      headers: { cookie: teacherCookie },
      payload: { title: 'x' },
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/question-groups/9999',
      headers: { cookie: teacherCookie },
    });
    expect(del.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups/abc',
      headers: { cookie: adminCookie },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('同名题组允许并存（题组不是目录，不要求唯一）', async () => {
    const a = await createGroup('同名组');
    const b = await createGroup('同名组');
    expect(a).not.toBe(b);
  });
});

describe('组内成员', () => {
  let groupId = 0;

  beforeAll(async () => {
    groupId = await createGroup('勾股定理 · 一组变式');
  });

  it('批量加入后按「母题在前、变式按 sort」返回，计数正确', async () => {
    await addItems(groupId, [10, 11], 'variant');
    await addItems(groupId, [9], 'stem');

    const detail = await detailOf(groupId);
    expect(detail.roleCounts).toEqual({ stem: 1, variant: 2 });
    expect(detail.total).toBe(3);
    expect(detail.questions.map((q) => q.id)).toEqual([9, 10, 11]);
    expect(detail.questions.map((q) => q.role)).toEqual(['stem', 'variant', 'variant']);
    expect(detail.questions[0]?.stem).toBe('第 9 题的题干');
    expect(detail.questions[0]?.type).toBe('fill');
  });

  it('重复加入不重复计数，只更新角色；同一次请求里的重复 id 会去重', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${groupId}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [10, 10, 11], role: 'stem' },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ added: number; updated: number; total: number }>(res);
    expect(body.added).toBe(0);
    expect(body.updated).toBe(2);
    expect(body.total).toBe(3);

    const detail = await detailOf(groupId);
    expect(detail.roleCounts).toEqual({ stem: 3, variant: 0 });
  });

  it('role 只能是 stem / variant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${groupId}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [10], role: 'child' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('题目不存在时整批拒绝，不做「一半成功」', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${groupId}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [10, 99999], role: 'variant' },
    });
    expect(res.statusCode).toBe(400);
    expect((await detailOf(groupId)).total).toBe(3);
  });

  it('移出题目：不在组内的返回 404，在组内的计数递减', async () => {
    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/v1/question-groups/${groupId}/items/10`,
      headers: { cookie: teacherCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect((await detailOf(groupId)).total).toBe(2);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/question-groups/${groupId}/items/10`,
      headers: { cookie: teacherCookie },
    });
    expect(again.statusCode).toBe(404);
  });

  it('一个题组最多 50 题：第 51 题被拒绝', async () => {
    const full = await createGroup('满员组');
    await addItems(
      full,
      Array.from({ length: 50 }, (_, i) => i + 1),
      'variant',
    );
    const over = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${full}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [51], role: 'variant' },
    });
    expect(over.statusCode).toBe(400);
    expect((await detailOf(full)).total).toBe(50);

    // 一次请求超过 50 个 id 同样拒绝（schema 之后服务层再兜一层）
    const batch = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${full}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: Array.from({ length: 51 }, (_, i) => i + 1), role: 'variant' },
    });
    expect(batch.statusCode).toBe(400);
  });

  it('题干超过 200 字时截断，且不切断 markdown 图片', async () => {
    const long = await createGroup('长题干组');
    // 图片语法从第 150 字开始、一直延伸到 200 字之后：直接 slice(0,200) 会切在 URL 中间
    const imageStem = `${'字'.repeat(150)}![](/api/v1/question-media/${'a'.repeat(100)})${'尾'.repeat(60)}`;
    built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (1000, 1, 'single', ?)", [imageStem]);
    await addItems(long, [1000], 'stem');
    const detail = await detailOf(long);
    const stem = detail.questions[0]?.stem ?? '';
    expect(stem.length).toBeLessThanOrEqual(201);
    expect(stem.endsWith('…')).toBe(true);
    // 残缺的图片语法没有透出来
    expect(stem.includes('question-media')).toBe(false);
  });
});

describe('题目 → 所属题组', () => {
  it('返回所属题组与角色；一道题可以属于多个组', async () => {
    const g1 = await createGroup('跨组 A');
    const g2 = await createGroup('跨组 B');
    // 用新题，避免和前面的用例共用题目造成「所属组多一个」
    built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (800, 1, 'fill', '跨组题')");
    await addItems(g1, [800], 'stem');
    await addItems(g2, [800], 'variant');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/questions/800/groups',
      headers: { cookie: studentCookie },
    });
    expect(res.statusCode).toBe(200);
    const groups = json<{ groups: { id: number; title: string; role: string }[] }>(res).groups;
    expect(groups.map((g) => g.id).sort((a, b) => a - b)).toEqual([g1, g2].sort((a, b) => a - b));
    expect(groups.find((g) => g.id === g1)?.role).toBe('stem');
    expect(groups.find((g) => g.id === g2)?.role).toBe('variant');
  });

  it('题目不存在返回 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/questions/99999/groups',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('题库列表按题组筛选', () => {
  it('groupId 只返回该组里、且属于当前题库的题', async () => {
    const g = await createGroup('筛选组');
    await addItems(g, [40, 41], 'variant');
    // 900 属于题库 2：按题库 1 + 组筛选时不应出现它
    built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (900, 2, 'fill', '别的题库的题')");
    await addItems(g, [900], 'variant');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/1/questions?groupId=${g}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ total: number; questions: { id: number }[] }>(res);
    expect(body.total).toBe(2);
    expect(body.questions.map((q) => q.id).sort((a, b) => a - b)).toEqual([40, 41]);

    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/1/questions?groupId=',
      headers: { cookie: adminCookie },
    });
    expect(json<{ total: number }>(all).total).toBeGreaterThan(2);

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/1/questions?groupId=abc',
      headers: { cookie: adminCookie },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('列表 search 按标题 / 备注模糊搜', async () => {
    await createGroup('二次函数专题', '抛物线开口方向');
    const byTitle = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups?search=二次函数',
      headers: { cookie: adminCookie },
    });
    expect(json<{ groups: GroupItem[] }>(byTitle).groups.every((g) => g.title.includes('二次函数'))).toBe(true);

    const byNote = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups?search=抛物线',
      headers: { cookie: adminCookie },
    });
    expect(json<{ groups: GroupItem[] }>(byNote).groups.length).toBe(1);
  });
});

describe('删除与级联', () => {
  it('删组会删掉成员关系，但不删题目本身', async () => {
    const g = await createGroup('待删除组');
    await addItems(g, [50, 51], 'variant');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/question-groups/${g}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/question-groups/${g}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(404);

    const items = built.deps.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM question_group_items WHERE group_id = ?',
      [g],
    );
    expect(items?.c).toBe(0);
    // 题目还在
    expect(built.deps.db.get('SELECT id FROM questions WHERE id = 50')).toBeDefined();
  });

  it('删题会带走成员关系（外键 ON DELETE CASCADE）', async () => {
    const g = await createGroup('删题级联组');
    built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem) VALUES (700, 1, 'fill', '将被删除的题')");
    await addItems(g, [700], 'variant');
    built.deps.db.run('DELETE FROM questions WHERE id = 700');
    expect((await detailOf(g)).total).toBe(0);
  });
});

describe('权限与审计', () => {
  it('学员可读不可写（写接口 403）', async () => {
    const g = await createGroup('权限组');
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/question-groups',
      headers: { cookie: studentCookie },
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: studentCookie },
      payload: { title: '学员想建组' },
    });
    expect(write.statusCode).toBe(403);

    const addItem = await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${g}/items`,
      headers: { cookie: studentCookie },
      payload: { questionIds: [20], role: 'variant' },
    });
    expect(addItem.statusCode).toBe(403);
  });

  it('未登录 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/question-groups' });
    expect(res.statusCode).toBe(401);
  });

  it('写操作落审计', async () => {
    const rows = built.deps.db.all<{ action: string; target_type: string }>(
      "SELECT action, target_type FROM audit_logs WHERE target_type = 'question_group'",
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('question_group.create');
    expect(actions).toContain('question_group.update');
    expect(actions).toContain('question_group.items.add');
    expect(actions).toContain('question_group.items.remove');
    expect(actions).toContain('question_group.delete');
  });
});
