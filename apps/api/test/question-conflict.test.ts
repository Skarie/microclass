/**
 * 「同题不同答案」核对：台账扫描、分组列表、选定答案整组统一、忽略、恢复、
 * 按多数答案批量处理（含并列跳过），以及权限校验。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { questionFingerprint } from '../src/domain/question.js';
import { hashPassword, newSalt } from '../src/security/password.js';

let app: FastifyInstance;
let dataDir: string;
let db: Db;
let deps: Awaited<ReturnType<typeof buildApp>>['deps'];
let cookie = '';
let teacherCookie = '';
let studentCookie = '';
let bankA = 0;
let bankB = 0;

const STEM = '3 时 = ____ 分';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function addQuestion(bankId: number, stem: string, answer: string, point = ''): number {
  return db.run(
    `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, stage, book, chapter, point, content_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      bankId,
      'fill',
      stem,
      '[]',
      answer,
      'easy',
      '数学',
      '小学',
      '三年级上册',
      '1 时、分、秒',
      point,
      questionFingerprint(stem, []),
    ],
  ).lastInsertRowid;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

/** 建号（走仓储 + 与登录同一套口令哈希） */
function makeUser(username: string, password: string, role: 'teacher' | 'student'): void {
  const salt = newSalt();
  deps.users.create({ username, salt, hash: hashPassword(password, salt), role });
}

async function sync(): Promise<{
  scannedGroups: number;
  total: number;
  pending: number;
  inserted: number;
  removed: number;
  reason: string;
  ms: { scan: number; cleanup: number; write: number; meta: number; total: number };
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/question-conflicts/sync',
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return json(res);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-conflict-'));
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

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['测试课程']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['测试课时', '第一章']);
  bankA = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,1,?,?,?)', [
    '第一章 · 测试课时',
    'lesson',
    '数学',
    '三年级上册',
  ]).lastInsertRowid;
  bankB = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,NULL,?,?,?)', [
    '三年级上册 · 期末测评 · 期末测试卷A',
    'paper',
    '数学',
    '三年级上册',
  ]).lastInsertRowid;

  // 冲突组：同一题干（同一指纹）出现 3 次，两种答案（180 ×2、120 ×1）
  addQuestion(bankA, STEM, '180', '时间的推算');
  addQuestion(bankA, '3时=____分', '180', '时间的推算'); // 归一化后同题
  addQuestion(bankB, STEM, '120');
  // 同题同答案：是「重复题」，不算冲突
  addQuestion(bankA, '一天有 ____ 小时', '24');
  addQuestion(bankB, '一天有 ____ 小时', '24');
  // 单题：不算冲突
  addQuestion(bankA, '一周有 ____ 天', '7');

  // 教师 / 学生账号（直接建号，避免依赖「是否开放注册」的设置）
  makeUser('t1', 'teach12345', 'teacher');
  makeUser('s1', 'stud12345', 'student');
  teacherCookie = await login('t1', 'teach12345');
  studentCookie = await login('s1', 'stud12345');
});

afterAll(async () => {
  await app.close();
});

describe('冲突题台账扫描', () => {
  it('扫描出「同题不同答案」的组，同题同答案不算冲突', async () => {
    const res = await sync();
    expect(res.pending).toBe(1);
    expect(res.total).toBe(1);
    expect(res.ms.total).toBeGreaterThanOrEqual(res.ms.scan);
  });

  it('列表接口不隐式扫全库：只报告台账是否过期', async () => {
    const res = json<{ sync: { scanned: boolean; reason: string; stale: boolean } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(res.sync.scanned).toBe(false);
    expect(res.sync.stale).toBe(false);
    expect(res.sync.reason).toBe('fresh');

    // 题库有新题 → 台账报「过期」，但仍不扫（扫描由用户点按钮触发）
    addQuestion(bankA, '7 时 = ____ 分', '420');
    const stale = json<{ sync: { scanned: boolean; reason: string; stale: boolean } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(stale.sync.scanned).toBe(false);
    expect(stale.sync.stale).toBe(true);
    expect(stale.sync.reason).toBe('grew');
    db.run('DELETE FROM questions WHERE stem = ?', ['7 时 = ____ 分']);
  });

  it('显式重扫：题量增长过会重扫，题目没动过就不扫', async () => {
    const grew = await sync();
    expect(grew.reason).toBe('forced'); // 按钮就是明确动作，按请求执行
    addQuestion(bankA, '5 时 = ____ 分', '300');
    const before = await sync();
    expect(before.total).toBe(1); // 新题不成组，不影响台账
    db.run('DELETE FROM questions WHERE stem = ?', ['5 时 = ____ 分']);
  });

  it('列表带答案分布（按票数倒序）与组内题量', async () => {
    const res = json<{
      counts: { pending: number; resolved: number };
      total: number;
      items: {
        contentHash: string;
        stem: string;
        groupSize: number;
        answerCount: number;
        answers: { answer: string; n: number }[];
      }[];
    }>(await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }));
    expect(res.total).toBe(1);
    const group = res.items[0];
    expect(group?.stem).toBe(STEM);
    expect(group?.groupSize).toBe(3);
    expect(group?.answerCount).toBe(2);
    expect(group?.answers.map((a) => [a.answer, a.n])).toEqual([
      ['180', 2],
      ['120', 1],
    ]);
  });

  it('详情给出组内每道题所在的题库与来源，便于判断信哪个答案', async () => {
    const list = json<{ items: { contentHash: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    const hash = list.items[0]?.contentHash ?? '';
    const detail = json<{ questions: { id: number; answer: string; bank_name: string; bank_kind: string }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/question-conflicts/${hash}`, headers: { cookie } }),
    );
    expect(detail.questions).toHaveLength(3);
    expect(detail.questions.map((q) => q.answer).sort()).toEqual(['120', '180', '180']);
    expect(detail.questions.map((q) => q.bank_name)).toContain('三年级上册 · 期末测评 · 期末测试卷A');
    expect(detail.questions.some((q) => q.bank_kind === 'paper')).toBe(true);
  });
});

describe('逐组核对', () => {
  it('选定答案后整组统一，且该组不再待核对', async () => {
    const list = json<{ items: { contentHash: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    const hash = list.items[0]?.contentHash ?? '';
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/question-conflicts/${hash}/resolve`,
      headers: { cookie },
      payload: { answer: '180' },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ updated: number; answer: string }>(res)).toEqual({ updated: 3, answer: '180' });

    // 组内 3 道题的答案全部变成 180
    const rows = db.all<{ answer: string; n: number }>(
      'SELECT answer, COUNT(*) AS n FROM questions WHERE content_hash = ? GROUP BY answer',
      [hash],
    );
    expect(rows).toEqual([{ answer: '180', n: 3 }]);

    const after = json<{ counts: { pending: number; resolved: number }; total: number }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(after.total).toBe(0);
    expect(after.counts.resolved).toBe(1);
  });

  it('已核对记录不会因再次扫描而丢失，但数据被改回冲突会重新打回待核对', async () => {
    await sync();
    const kept = json<{ counts: { pending: number; resolved: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=resolved', headers: { cookie } }),
    );
    expect(kept.counts.resolved).toBe(1);

    // 有人又把答案改回 120 → 组重新冲突，状态回到 pending
    addQuestion(bankB, STEM, '120');
    const res = await sync();
    expect(res.pending).toBe(1);
    const back = json<{ counts: { pending: number; resolved: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(back.counts.pending).toBe(1);
    expect(back.counts.resolved).toBe(0);
  });

  it('忽略后不再待核对，题目保持原样；恢复后回到待核对', async () => {
    const list = json<{ items: { contentHash: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    const hash = list.items[0]?.contentHash ?? '';

    const ignored = await app.inject({
      method: 'POST',
      url: `/api/v1/question-conflicts/${hash}/ignore`,
      headers: { cookie },
    });
    expect(ignored.statusCode).toBe(200);
    // 题目没被改动：仍然是两种答案
    expect(
      db.get<{ c: number }>('SELECT COUNT(DISTINCT answer) AS c FROM questions WHERE content_hash = ?', [hash])?.c,
    ).toBe(2);

    const afterIgnore = json<{ counts: { pending: number; ignored: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(afterIgnore.counts.pending).toBe(0);
    expect(afterIgnore.counts.ignored).toBe(1);

    // 再次扫描也不会把 ignored 打回 pending
    await sync();
    const stable = json<{ counts: { pending: number; ignored: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(stable.counts.pending).toBe(0);
    expect(stable.counts.ignored).toBe(1);

    const reopened = await app.inject({
      method: 'POST',
      url: `/api/v1/question-conflicts/${hash}/reopen`,
      headers: { cookie },
    });
    expect(reopened.statusCode).toBe(200);
    const afterReopen = json<{ counts: { pending: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(afterReopen.counts.pending).toBe(1);
  });
});

describe('批量按多数答案处理', () => {
  it('默认只预演：统计要改的组，不动数据', async () => {
    const res = json<{ groups: number; questions: number; skipped: number; dryRun: boolean }>(
      await app.inject({ method: 'POST', url: '/api/v1/question-conflicts/resolve-majority', headers: { cookie } }),
    );
    expect(res.dryRun).toBe(true);
    expect(res.groups).toBe(1);
    // 组内 4 题：3 道已被改成 180（上一组核对结果）+ 又塞进来的 1 道 120
    expect(res.questions).toBe(4);
    expect(res.skipped).toBe(0);
    // 数据未被改动
    expect(
      db.get<{ c: number }>('SELECT COUNT(DISTINCT answer) AS c FROM questions WHERE content_hash = ?', [
        questionFingerprint(STEM, []),
      ])?.c,
    ).toBe(2);
  });

  it('dryRun=0 落库：按多数票统一整组', async () => {
    const res = json<{ groups: number; questions: number; dryRun: boolean }>(
      await app.inject({
        method: 'POST',
        url: '/api/v1/question-conflicts/resolve-majority?dryRun=0',
        headers: { cookie },
      }),
    );
    expect(res.dryRun).toBe(false);
    expect(res.groups).toBe(1);
    expect(
      db.get<{ c: number }>('SELECT COUNT(DISTINCT answer) AS c FROM questions WHERE content_hash = ?', [
        questionFingerprint(STEM, []),
      ])?.c,
    ).toBe(1);
  });

  it('票数并列的组不猜，计入 skipped', async () => {
    const stem = '正方形的周长是 ____ 厘米';
    addQuestion(bankA, stem, '8');
    addQuestion(bankB, stem, '12');
    const hash = questionFingerprint(stem, []);
    await sync(); // 新造的两道题要显式重扫才会进台账
    const before = json<{ counts: { pending: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(before.counts.pending).toBe(1);

    const res = json<{ groups: number; skipped: number; dryRun: boolean }>(
      await app.inject({ method: 'POST', url: '/api/v1/question-conflicts/resolve-majority', headers: { cookie } }),
    );
    expect(res.groups).toBe(0);
    expect(res.skipped).toBe(1);

    // 并列组仍然待核对，数据保持两种答案
    const after = json<{ counts: { pending: number } }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    expect(after.counts.pending).toBe(1);
    expect(
      db.get<{ c: number }>('SELECT COUNT(DISTINCT answer) AS c FROM questions WHERE content_hash = ?', [hash])?.c,
    ).toBe(2);
  });
});

describe('权限与入参校验', () => {
  it('教师可以核对，学生只能看列表、不能改', async () => {
    const list = json<{ items: { contentHash: string }[] }>(
      await app.inject({
        method: 'GET',
        url: '/api/v1/question-conflicts?status=pending',
        headers: { cookie: studentCookie },
      }),
    );
    expect(list.items.length).toBeGreaterThan(0);
    const hash = list.items[0]?.contentHash ?? '';

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/question-conflicts/${hash}/resolve`,
      headers: { cookie: studentCookie },
      payload: { answer: '8' },
    });
    expect(denied.statusCode).toBe(403);

    const teacherSync = await app.inject({
      method: 'POST',
      url: '/api/v1/question-conflicts/sync',
      headers: { cookie: teacherCookie },
    });
    expect(teacherSync.statusCode).toBe(200);
  });

  it('未登录 401；空的选定答案 400；不存在的组 404', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/question-conflicts' });
    expect(anon.statusCode).toBe(401);

    const list = json<{ items: { contentHash: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    const hash = list.items[0]?.contentHash ?? '';
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/question-conflicts/${hash}/resolve`,
      headers: { cookie },
      payload: { answer: '   ' },
    });
    expect(empty.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/question-conflicts/deadbeefdeadbeef',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});

/**
 * 回归：管理端/接口新增的题目也必须参与标准化（指纹 + 带图标记）。
 * 曾经只有导入器写这两列，接口新增的题目指纹为空 —— 于是它们查重、冲突体检全都看不见。
 */
describe('接口写入的题目也参与查重与冲突检测', () => {
  it('接口新增的同题不同答案会被扫出来，并写好带图标记', async () => {
    const bank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie },
      payload: { name: '接口新增题库' },
    });
    expect(bank.statusCode).toBe(200);
    const bankId = json<{ id: number }>(bank).id;

    const stem = '接口冲突题：2 千米 = ____ 米';
    for (const answer of ['2000', '200']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/questions`,
        headers: { cookie },
        payload: { bankId, type: 'fill', stem, answer },
      });
      expect(res.statusCode).toBe(200);
    }
    // 带图的题目：has_image 必须为 1（体检用预计算列）
    const withImage = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
      payload: {
        bankId,
        type: 'fill',
        stem: '看图填空 ![](/api/v1/question-media/aa.png)，结果是 ____',
        answer: '3',
      },
    });
    expect(withImage.statusCode).toBe(200);
    const imageId = json<{ id: number }>(withImage).id;

    const row = db.get<{ content_hash: string; has_image: number }>(
      'SELECT content_hash, has_image FROM questions WHERE id = ?',
      [imageId],
    );
    expect(row?.has_image).toBe(1);
    expect(row?.content_hash).toBe(questionFingerprint('看图填空 ![](/api/v1/question-media/aa.png)，结果是 ____', []));

    await sync(); // 显式重扫（列表页不隐式扫库）
    const list = json<{ items: { contentHash: string; answers: { answer: string; n: number }[] }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/question-conflicts?status=pending', headers: { cookie } }),
    );
    const group = list.items.find((i) => i.contentHash === questionFingerprint(stem, []));
    expect(group, '接口新增的同题不同答案应出现在待核对列表里').toBeTruthy();
    expect(group?.answers.map((a) => a.answer).sort()).toEqual(['200', '2000']);
  });
});
