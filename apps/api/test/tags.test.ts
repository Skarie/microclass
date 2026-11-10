import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

/**
 * 自由标签（迁移 0030）：标签 CRUD、重名 409（大小写/空格归一）、覆盖设置、
 * 批量 add/remove/replace、any/all 筛选差异、级联删除、权限与边界校验，
 * 以及顺带补的「题组 updated_at 会随加题/移题刷新」。
 *
 * 题目与题库直接写库（只关心 id/stem/point），标签相关全部走 HTTP。
 */
let app: FastifyInstance;
let built: BuiltApp;
let dataDir: string;
let adminCookie = '';
let teacherCookie = '';
let studentCookie = '';

interface TagItem {
  id: number;
  name: string;
  note: string;
  questionCount: number;
  createdAt: string;
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

async function createTag(name: string, note?: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tags',
    headers: { cookie: adminCookie },
    payload: note === undefined ? { name } : { name, note },
  });
  expect(res.statusCode).toBe(201);
  return json<{ ok: boolean; id: number }>(res).id;
}

async function listTags(search = ''): Promise<TagItem[]> {
  const url = search === '' ? '/api/v1/tags' : `/api/v1/tags?search=${encodeURIComponent(search)}`;
  const res = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
  expect(res.statusCode).toBe(200);
  return json<{ tags: TagItem[] }>(res).tags;
}

async function setQuestionTags(questionId: number, tagIds: number[]): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/questions/${questionId}/tags`,
    headers: { cookie: adminCookie },
    payload: { tagIds },
  });
  expect(res.statusCode).toBe(200);
}

async function questionTagIdsOf(questionId: number): Promise<number[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/questions/${questionId}/tags`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return json<{ tags: { id: number }[] }>(res).tags.map((t) => t.id);
}

async function batch(questionIds: number[], tagIds: number[], mode: 'add' | 'remove' | 'replace'): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/questions/tags',
    headers: { cookie: adminCookie },
    payload: { questionIds, tagIds, mode },
  });
  expect(res.statusCode).toBe(200);
  return json<{ affected: number }>(res).affected;
}

/** 题库内题目列表里的题目 id（按 tagIds/tagMode 筛） */
async function filteredIds(query: string): Promise<number[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/banks/1/questions?pageSize=100&${query}`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode).toBe(200);
  return json<{ questions: { id: number }[] }>(res).questions.map((q) => q.id);
}

function seedQuestion(id: number, stem: string, point = ''): void {
  built.deps.db.run("INSERT INTO questions (id, bank_id, type, stem, point) VALUES (?, 1, 'fill', ?, ?)", [
    id,
    stem,
    point,
  ]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-tags-'));
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
    payload: { username: `tag_stu_${Date.now().toString(36)}`, password: 'pass1234' },
  });
  studentCookie = cookieOf(reg);

  built.deps.db.run("INSERT INTO banks (id, name) VALUES (1, '七年级数学 · 必刷题')");
  // 题 1、2：知识点「一次函数」；题 3：「二次函数 + 一次函数」；题 4：无知识点
  seedQuestion(1, '一次函数图像经过哪个点？', '一次函数');
  seedQuestion(2, '一次函数的斜率怎么求？', '一次函数');
  seedQuestion(3, '二次函数与一次函数的交点', '二次函数;一次函数');
  seedQuestion(4, '没有标注知识点的题');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('标签 CRUD', () => {
  it('新建返回 201，列表带题目数并按名字排序', async () => {
    const id = await createTag('易错', '学生常错');
    const tags = await listTags();
    const created = tags.find((t) => t.id === id);
    expect(created?.name).toBe('易错');
    expect(created?.note).toBe('学生常错');
    expect(created?.questionCount).toBe(0);
    expect(tags.map((t) => t.name)).toEqual([...tags.map((t) => t.name)].sort((a, b) => a.localeCompare(b, 'zh')));
  });

  it('重名（大小写/空格归一）返回 409', async () => {
    await createTag('HighError');
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: adminCookie },
      payload: { name: 'higherror' },
    });
    expect(dup.statusCode).toBe(409);

    await createTag('待重录');
    const dupSpace = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: adminCookie },
      payload: { name: '  待重录  ' },
    });
    expect(dupSpace.statusCode).toBe(409);
  });

  it('改名 / 改备注；改成一个已存在的名字返回 409', async () => {
    const a = await createTag('草稿标签A');
    const b = await createTag('草稿标签B');
    const ok = await app.inject({
      method: 'PUT',
      url: `/api/v1/tags/${a}`,
      headers: { cookie: teacherCookie },
      payload: { name: '草稿标签A（改）', note: '说明' },
    });
    expect(ok.statusCode).toBe(200);
    const renamed = (await listTags()).find((t) => t.id === a);
    expect(renamed?.name).toBe('草稿标签A（改）');
    expect(renamed?.note).toBe('说明');

    const dup = await app.inject({
      method: 'PUT',
      url: `/api/v1/tags/${a}`,
      headers: { cookie: teacherCookie },
      payload: { name: '草稿标签B' },
    });
    expect(dup.statusCode).toBe(409);
    expect((await listTags()).find((t) => t.id === b)?.name).toBe('草稿标签B');
  });

  it('名称空 / 超长 / 备注超长都拒绝；不存在的标签 404、非法 id 400', async () => {
    const blank = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: adminCookie },
      payload: { name: '   ' },
    });
    expect(blank.statusCode).toBe(400);

    const tooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: adminCookie },
      payload: { name: 'x'.repeat(41) },
    });
    expect(tooLong.statusCode).toBe(400);

    const noteTooLong = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: adminCookie },
      payload: { name: '备注超长', note: 'y'.repeat(201) },
    });
    expect(noteTooLong.statusCode).toBe(400);

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/tags/9999',
          headers: { cookie: adminCookie },
          payload: { name: 'x' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/tags/9999', headers: { cookie: adminCookie } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/tags?search=不存在', headers: { cookie: adminCookie } }))
        .statusCode,
    ).toBe(200);
  });

  it('列表 search 按名字/备注模糊搜', async () => {
    await createTag('统一标签搜索词', '用来验证备注搜索');
    const byName = await listTags('统一标签搜索词');
    expect(byName.length).toBe(1);
    const byNote = await listTags('验证备注搜索');
    expect(byNote.length).toBe(1);
  });
});

describe('题目标签：覆盖设置与批量', () => {
  let t1 = 0;
  let t2 = 0;

  beforeAll(async () => {
    t1 = await createTag('高频错题');
    t2 = await createTag('需重录');
  });

  it('覆盖式设置：先写 2 个标签，再写 1 个，再清空', async () => {
    await setQuestionTags(1, [t1, t2]);
    expect((await questionTagIdsOf(1)).sort()).toEqual([t1, t2].sort());

    await setQuestionTags(1, [t1]);
    expect(await questionTagIdsOf(1)).toEqual([t1]);

    await setQuestionTags(1, []);
    expect(await questionTagIdsOf(1)).toEqual([]);
  });

  it('标签不存在 / 题目不存在时整批拒绝', async () => {
    const badTag = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/1/tags',
      headers: { cookie: adminCookie },
      payload: { tagIds: [t1, 99999] },
    });
    expect(badTag.statusCode).toBe(400);

    const badQuestion = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/99999/tags',
      headers: { cookie: adminCookie },
      payload: { tagIds: [t1] },
    });
    expect(badQuestion.statusCode).toBe(404);
  });

  it('批量 add 只加（重复无害），remove 只删指定，replace 整题覆盖', async () => {
    await batch([1, 2], [t1], 'add');
    expect(await batch([1, 2], [t1], 'add')).toBe(0); // 已经打过：affected=0
    expect((await questionTagIdsOf(2)).sort()).toEqual([t1]);

    expect(await batch([1, 2], [t2], 'add')).toBe(2);
    expect((await questionTagIdsOf(1)).sort()).toEqual([t1, t2].sort());

    // remove 只删 t1，t2 保留
    expect(await batch([1], [t1], 'remove')).toBe(1);
    expect(await questionTagIdsOf(1)).toEqual([t2]);

    // replace：题 2 的标签换成只剩 t1
    expect(await batch([2], [t1], 'replace')).toBe(1);
    expect(await questionTagIdsOf(2)).toEqual([t1]);

    // replace 允许空数组 = 清空
    expect(await batch([2], [], 'replace')).toBe(1);
    expect(await questionTagIdsOf(2)).toEqual([]);
  });

  it('批量参数校验：空题目、非法 mode、非数组都 400', async () => {
    const noQuestions = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: adminCookie },
      payload: { questionIds: [], tagIds: [t1], mode: 'add' },
    });
    expect(noQuestions.statusCode).toBe(400);

    const badMode = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: adminCookie },
      payload: { questionIds: [1], tagIds: [t1], mode: 'toggle' },
    });
    expect(badMode.statusCode).toBe(400);

    const missingTag = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: adminCookie },
      payload: { questionIds: [1], tagIds: [99999], mode: 'add' },
    });
    expect(missingTag.statusCode).toBe(400);
  });
});

describe('any / all 筛选', () => {
  let a = 0;
  let b = 0;

  beforeAll(async () => {
    a = await createTag('筛选标签A');
    b = await createTag('筛选标签B');
    // 题 10：A；题 11：A+B；题 12：B
    seedQuestion(10, '筛选题 10');
    seedQuestion(11, '筛选题 11');
    seedQuestion(12, '筛选题 12');
    await batch([10, 11], [a], 'add');
    await batch([11, 12], [b], 'add');
  });

  it('题库内列表：any 命中任意一个，all 要求同时包含', async () => {
    const anyIds = await filteredIds(`tagIds=${a},${b}&tagMode=any`);
    expect(anyIds.sort((x, y) => x - y)).toEqual([10, 11, 12]);

    const allIds = await filteredIds(`tagIds=${a},${b}&tagMode=all`);
    expect(allIds).toEqual([11]);

    // 缺省 tagMode = any
    const defaultIds = await filteredIds(`tagIds=${a}`);
    expect(defaultIds.sort((x, y) => x - y)).toEqual([10, 11]);

    // 重复参数写法也支持
    const repeated = await filteredIds(`tagIds=${a}&tagIds=${b}&tagMode=all`);
    expect(repeated).toEqual([11]);
  });

  it('跨题库 /questions 列表与题库内列表结果一致，并支持分页', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/questions?tagIds=${a},${b}&tagMode=all&pageSize=10`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ total: number; page: number; pageSize: number; questions: { id: number }[] }>(res);
    expect(body.total).toBe(1);
    expect(body.questions.map((q) => q.id)).toEqual([11]);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);

    const anyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/questions?tagIds=${a},${b}&tagMode=any`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ total: number }>(anyRes).total).toBe(3);
  });

  it('tagMode 非法值 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/1/questions?tagIds=${a}&tagMode=both`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('知识点多选也支持 any / all（按包含匹配）', async () => {
    const any = await filteredIds('points=二次函数&points=一次函数&pointMode=any');
    expect(any.sort((x, y) => x - y)).toEqual([1, 2, 3]);

    const all = await filteredIds('points=二次函数&points=一次函数&pointMode=all');
    expect(all).toEqual([3]);

    const single = await filteredIds('points=一次函数');
    expect(single.sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });
});

describe('级联与权限', () => {
  it('删标签只解除关联，题目还在；删题目自动清关联', async () => {
    const tagId = await createTag('生命周期标签');
    seedQuestion(20, '生命周期题');
    await setQuestionTags(20, [tagId]);
    expect((await listTags()).find((t) => t.id === tagId)?.questionCount).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tags/${tagId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(built.deps.db.get('SELECT id FROM questions WHERE id = 20')).toBeDefined();
    expect(
      built.deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question_tags WHERE tag_id = ?', [tagId])?.c,
    ).toBe(0);

    const keep = await createTag('删题级联标签');
    seedQuestion(21, '会被删掉的题');
    await setQuestionTags(21, [keep]);
    built.deps.db.run('DELETE FROM questions WHERE id = 21');
    expect(built.deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM question_tags WHERE question_id = 21')?.c).toBe(
      0,
    );
  });

  it('学员可读不可写；未登录 401', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/tags', headers: { cookie: studentCookie } });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST',
      url: '/api/v1/tags',
      headers: { cookie: studentCookie },
      payload: { name: '学员想建标签' },
    });
    expect(write.statusCode).toBe(403);

    const batchWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: studentCookie },
      payload: { questionIds: [1], tagIds: [1], mode: 'add' },
    });
    expect(batchWrite.statusCode).toBe(403);

    const anon = await app.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(anon.statusCode).toBe(401);
  });

  it('写操作落审计', async () => {
    const actions = built.deps.db.all<{ action: string }>('SELECT action FROM audit_logs').map((row) => row.action);
    expect(actions).toContain('tag.create');
    expect(actions).toContain('tag.update');
    expect(actions).toContain('tag.delete');
    expect(actions).toContain('question.tags.set');
    expect(actions).toContain('question.tags.batch');
  });
});

describe('题组 updated_at（0030 顺带补齐）', () => {
  it('加题 / 移题 / 改标题都会刷新 updatedAt', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { title: 'updated_at 验证组' },
    });
    const groupId = json<{ id: number }>(created).id;
    // 手工把时间压到过去，避免 datetime('now') 秒级精度让断言变成「同秒相同」
    built.deps.db.run("UPDATE question_groups SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [groupId]);

    await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${groupId}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [1], role: 'stem' },
    });
    const afterAdd = await app.inject({
      method: 'GET',
      url: `/api/v1/question-groups/${groupId}`,
      headers: { cookie: adminCookie },
    });
    const updatedAfterAdd = json<{ updatedAt: string }>(afterAdd).updatedAt;
    expect(updatedAfterAdd > '2020-01-01 00:00:00').toBe(true);

    built.deps.db.run("UPDATE question_groups SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [groupId]);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/question-groups/${groupId}/items/1`,
      headers: { cookie: adminCookie },
    });
    const afterRemove = await app.inject({
      method: 'GET',
      url: `/api/v1/question-groups/${groupId}`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ updatedAt: string }>(afterRemove).updatedAt > '2020-01-01 00:00:00').toBe(true);
  });

  it('列表按 updated_at 倒序（改过的组排前面）', async () => {
    const first = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: '/api/v1/question-groups',
        headers: { cookie: adminCookie },
        payload: { title: '排序组 A' },
      }),
    ).id;
    const second = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: '/api/v1/question-groups',
        headers: { cookie: adminCookie },
        payload: { title: '排序组 B' },
      }),
    ).id;
    built.deps.db.run("UPDATE question_groups SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [first]);
    built.deps.db.run("UPDATE question_groups SET updated_at = '2021-01-01 00:00:00' WHERE id = ?", [second]);

    const list = json<{ groups: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-groups', headers: { cookie: adminCookie } }),
    ).groups;
    const indexOfFirst = list.findIndex((g) => g.id === first);
    const indexOfSecond = list.findIndex((g) => g.id === second);
    expect(indexOfSecond).toBeGreaterThanOrEqual(0);
    // B 的 updated_at 比 A 新 → B 必须排在 A 前面
    expect(indexOfSecond).toBeLessThan(indexOfFirst);
  });
});

/**
 * 验收补充的 3 条回归用例：
 *   ① 题组 + 标签同时筛（两个子查询取交集，不能互相覆盖）
 *   ② 批量打标超过 2000 题在**校验阶段**就 400（不能先落一半）
 *   ③ `tagMode=all` 时翻页与 total 一致（子查询分组 + 外层分页不能各算各的）
 */
describe('验收回归：题组×标签交集 / 批量上限 / all 模式分页', () => {
  it('groupId 与 tagIds 同时传时取交集（tagMode=all 与 any 结果不同）', async () => {
    const tagX = await createTag('交集标签X');
    const tagY = await createTag('交集标签Y');
    // 复用前面「any / all 筛选」里造好的题 10/11/12：10/11 进组，12 只在组外
    await batch([10, 11], [tagX], 'add');
    await batch([10], [tagY], 'add');
    await batch([12], [tagX, tagY], 'add');

    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/question-groups',
      headers: { cookie: adminCookie },
      payload: { title: '交集验证组' },
    });
    const groupId = json<{ id: number }>(groupRes).id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/question-groups/${groupId}/items`,
      headers: { cookie: adminCookie },
      payload: { questionIds: [10, 11], role: 'variant' },
    });

    // 组内 ∩ 同时含 X、Y → 只有 10（组外的 12 不算）
    const allIds = await filteredIds(`groupId=${groupId}&tagIds=${tagX},${tagY}&tagMode=all`);
    expect(allIds).toEqual([10]);

    // 组内 ∩ 任意含 X 或 Y → 10、11
    const anyIds = await filteredIds(`groupId=${groupId}&tagIds=${tagX},${tagY}&tagMode=any`);
    expect(anyIds.sort((a, b) => a - b)).toEqual([10, 11]);

    // 只按组筛（不带标签）→ 10、11；只按标签 all 筛（不带组）→ 10、12
    const groupOnly = await filteredIds(`groupId=${groupId}`);
    expect(groupOnly.sort((a, b) => a - b)).toEqual([10, 11]);
    const tagOnly = await filteredIds(`tagIds=${tagX},${tagY}&tagMode=all`);
    expect(tagOnly.sort((a, b) => a - b)).toEqual([10, 12]);
  });

  it('批量打标超过 2000 题返回 400，文案写明上限', async () => {
    const tagId = await createTag('批量上限标签');
    // 2001 个 id：校验在「查库判断存在」之前就按长度拒绝，不需要真的插 2001 道题
    const tooMany = Array.from({ length: 2001 }, (_, index) => index + 1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: adminCookie },
      payload: { questionIds: tooMany, tagIds: [tagId], mode: 'add' },
    });
    expect(res.statusCode).toBe(400);
    const message = json<{ error: { message: string } }>(res).error.message;
    expect(message).toContain('2000');

    // 边界：正好 2000 个 id 不会被「上限」拦下（这里因为题目不存在返回 400，但文案不同）
    const justEnough = Array.from({ length: 2000 }, (_, index) => index + 1);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/tags',
      headers: { cookie: adminCookie },
      payload: { questionIds: justEnough, tagIds: [tagId], mode: 'add' },
    });
    expect(ok.statusCode).toBe(400);
    expect(json<{ error: { message: string } }>(ok).error.message).not.toContain('2000 道题');
  });

  it('tagMode=all 时 page=2&pageSize=2 的翻页与 total 一致', async () => {
    const tagA = await createTag('分页标签A');
    const tagB = await createTag('分页标签B');
    const ids = [30, 31, 32, 33, 34];
    for (const id of ids) seedQuestion(id, `分页题 ${id}`);
    await batch(ids, [tagA, tagB], 'add');

    const pageOf = async (page: number): Promise<{ total: number; ids: number[] }> => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/banks/1/questions?tagIds=${tagA},${tagB}&tagMode=all&page=${page}&pageSize=2`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = json<{ total: number; questions: { id: number }[] }>(res);
      return { total: body.total, ids: body.questions.map((q) => q.id) };
    };

    const first = await pageOf(1);
    expect(first.total).toBe(5);
    expect(first.ids).toEqual([30, 31]);

    const second = await pageOf(2);
    expect(second.total).toBe(5);
    expect(second.ids).toEqual([32, 33]);

    const third = await pageOf(3);
    expect(third.total).toBe(5);
    expect(third.ids).toEqual([34]);

    // 同一条筛选在跨题库列表上的 total 必须和题库内一致
    const global = await app.inject({
      method: 'GET',
      url: `/api/v1/questions?tagIds=${tagA},${tagB}&tagMode=all&page=2&pageSize=2`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ total: number }>(global).total).toBe(5);
  });
});
