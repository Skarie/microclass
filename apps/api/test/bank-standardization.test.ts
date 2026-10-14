/**
 * 题库标准化接口：题库类型/学科/书册筛选、题库体检（元数据覆盖率、重复题与答案冲突）。
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

let app: FastifyInstance;
let dataDir: string;
let db: Db;
let cookie = '';
let chapterBankId = 0;
let paperBankId = 0;
let lessonBankId = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-std-'));
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

  // 课程 + 课时（课时配套题库）
  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['测试课程']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['测试课时', '第一章']);
  lessonBankId = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,1,?,?,?)', [
    '第一章 · 测试课时',
    'lesson',
    '数学',
    '三年级上册',
  ]).lastInsertRowid;
  chapterBankId = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,NULL,?,?,?)', [
    '三年级上册 · 1 时、分、秒 · 时间的推算',
    'chapter',
    '数学',
    '三年级上册',
  ]).lastInsertRowid;
  paperBankId = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,NULL,?,?,?)', [
    '三年级上册 · 期末测评 · 期末测试卷A',
    'paper',
    '数学',
    '三年级上册',
  ]).lastInsertRowid;

  const meta = (bankId: number, i: number, stem: string, answer: string) =>
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, stage, book, chapter, point, content_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        bankId,
        'fill',
        stem,
        '[]',
        answer,
        i === 0 ? '' : 'easy',
        '数学',
        '小学',
        '三年级上册',
        '1 时、分、秒',
        '时间的推算',
        questionFingerprint(stem, []),
      ],
    );
  meta(chapterBankId, 0, '3 时 = ____ 分', '180');
  meta(chapterBankId, 1, '3 时=____分', '180'); // 与上一条同题（重复）
  meta(chapterBankId, 2, '3 时=____分', '120'); // 同题但答案冲突
  meta(paperBankId, 0, '一天有 ____ 小时', '24');
  meta(lessonBankId, 0, '测试课时题', 'x');
});

afterAll(async () => {
  await app.close();
});

describe('题库列表筛选', () => {
  it('按类型筛选：chapter / paper / lesson', async () => {
    const chapter = json<{ banks: { id: number; kind: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?kind=chapter', headers: { cookie } }),
    );
    expect(chapter.banks.map((b) => b.id)).toContain(chapterBankId);
    expect(chapter.banks.every((b) => b.kind === 'chapter')).toBe(true);

    const paper = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?kind=paper', headers: { cookie } }),
    );
    expect(paper.banks.map((b) => b.id)).toEqual([paperBankId]);

    const lesson = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?kind=lesson', headers: { cookie } }),
    );
    expect(lesson.banks.map((b) => b.id)).toEqual([lessonBankId]);
  });

  it('按学科/书册筛选与非法类型校验', async () => {
    const byBook = json<{ banks: unknown[] }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/banks?subject=${encodeURIComponent('数学')}&book=${encodeURIComponent('三年级上册')}`,
        headers: { cookie },
      }),
    );
    expect(byBook.banks).toHaveLength(3);

    const bad = await app.inject({ method: 'GET', url: '/api/v1/banks?kind=whatever', headers: { cookie } });
    expect(bad.statusCode).toBe(400);
  });

  it('lesson=orphan 仍只返回没有课时归属的题库', async () => {
    const res = json<{ banks: { id: number }[] }>(
      await app.inject({ method: 'GET', url: '/api/v1/banks?lesson=orphan', headers: { cookie } }),
    );
    expect(res.banks.map((b) => b.id).sort()).toEqual([chapterBankId, paperBankId].sort());
  });
});

describe('整卷试卷 → 一键建考试', () => {
  it('把题库里的题目按顺序生成一场已发布的考试', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${paperBankId}/exam`,
      headers: { cookie },
      payload: { courseId: 1, durationMinutes: 45, passScore: 70 },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ examId: number; questions: number }>(res);
    expect(body.questions).toBe(1);
    const exam = json<{ exam: { title: string; status: string; duration_minutes: number; pass_score: number } }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${body.examId}`, headers: { cookie } }),
    );
    expect(exam.exam.status).toBe('published');
    expect(exam.exam.duration_minutes).toBe(45);
    expect(exam.exam.pass_score).toBe(70);
    const paper = json<{ questions: unknown[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${body.examId}/paper`, headers: { cookie } }),
    );
    expect(paper.questions).toHaveLength(1);
  });

  it('课程不存在 / 题库为空时拒绝；学生无权调用', async () => {
    const noCourse = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${paperBankId}/exam`,
      headers: { cookie },
      payload: { courseId: 99999 },
    });
    expect(noCourse.statusCode).toBe(400);

    const emptyBank = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      headers: { cookie },
      payload: { name: '空题库' },
    });
    const emptyId = json<{ id: number }>(emptyBank).id;
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${emptyId}/exam`,
      headers: { cookie },
      payload: { courseId: 1 },
    });
    expect(empty.statusCode).toBe(400);
    expect(String(json<{ error?: { message?: string } }>(empty).error?.message)).toContain('还没有题目');

    const anon = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${paperBankId}/exam`,
      payload: { courseId: 1 },
    });
    expect(anon.statusCode).toBe(401);
  });
});

describe('题库内去重', () => {
  it('同题干同选项同答案的重复题只保留一条；答案冲突的组不动', async () => {
    // 单独造一个题库：两条完全相同的题（可删一条）+ 两条同题干不同答案（不动）
    const bankId = db.run('INSERT INTO banks (name, lesson_id, kind, subject, book) VALUES (?,NULL,?,?,?)', [
      '去重自检题库',
      'chapter',
      '数学',
      '三年级上册',
    ]).lastInsertRowid;
    const add = (stem: string, answer: string) =>
      db.run(
        `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, subject, book, point, content_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [bankId, 'fill', stem, '[]', answer, 'easy', '数学', '三年级上册', '时间的推算', questionFingerprint(stem, [])],
      ).lastInsertRowid;
    const keepId = add('4 时 = ____ 分', '240');
    const dupId = add('4时=____分', '240'); // 与上一条同题同答案
    add('4时=____分', '250'); // 同题干但答案冲突 → 整组不动

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/dedupe`,
      headers: { cookie },
      payload: {},
    });
    expect(preview.statusCode).toBe(200);
    const body = json<{ dryRun: boolean; groups: number; removable: number; removed: number }>(preview);
    expect(body.dryRun).toBe(true);
    expect(body.groups).toBe(0); // 同题不同答案 → 不自动处理
    expect(body.removable).toBe(0);

    // 把冲突的那条改掉后，重复组就能安全删除了
    db.run('UPDATE questions SET answer = ?, content_hash = ? WHERE id = ?', [
      '240',
      questionFingerprint('4时=____分', []),
      dupId + 1,
    ]);
    const run = json<{ removed: number; groups: number; removable: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/dedupe`,
        headers: { cookie },
        payload: { dryRun: false },
      }),
    );
    expect(run.groups).toBe(1);
    expect(run.removable).toBe(2); // 两条重复（dupId 与新改的那条）
    expect(run.removed).toBe(2);
    const left = json<{ total: number }>(
      await app.inject({ method: 'GET', url: `/api/v1/banks/${bankId}/questions`, headers: { cookie } }),
    ).total;
    expect(left).toBe(1);
    expect(db.get('SELECT id FROM questions WHERE bank_id = ?', [bankId])).toMatchObject({ id: keepId });

    const again = json<{ removable: number }>(
      await app.inject({ method: 'POST', url: `/api/v1/banks/${bankId}/dedupe`, headers: { cookie }, payload: {} }),
    );
    expect(again.removable).toBe(0);
  });

  it('题库不存在返回 404、未登录返回 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/banks/999999/dedupe', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    const anon = await app.inject({ method: 'POST', url: `/api/v1/banks/${chapterBankId}/dedupe` });
    expect(anon.statusCode).toBe(401);
  });
});

describe('跨题库按知识点/难度找题', () => {
  it('按知识点与难度过滤，并给出知识点聚合统计', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/questions/search?point=${encodeURIComponent('时间的推算')}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{
      questions: { point: string; bank_name: string }[];
      points: { point: string; questions: number; banks: number }[];
    }>(res);
    expect(body.questions.length).toBeGreaterThan(0);
    expect(body.questions.every((q) => q.point === '时间的推算')).toBe(true);
    expect(body.points[0]?.point).toBe('时间的推算');
    expect(body.points[0]?.banks).toBeGreaterThanOrEqual(1);

    const anon = await app.inject({ method: 'GET', url: '/api/v1/questions/search?point=x' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('难度配额组卷', () => {
  it('按难度配额抽题，并在题量不足时如实报告缺口', async () => {
    db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['组卷测试课程']);
    const created = json<{ id: number }>(
      await app.inject({
        method: 'POST',
        url: '/api/v1/exams',
        headers: { cookie },
        payload: { courseId: 2, title: '难度配额自检' },
      }),
    );
    // 课程题池为空 → 缺口应等于请求量
    const empty = json<{ added: number; requested: number; shortfall: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/exams/${created.id}/questions/random`,
        headers: { cookie },
        payload: { difficultyQuota: { easy: 2, hard: 1 } },
      }),
    );
    expect(empty.requested).toBe(3);
    expect(empty.added).toBe(0);
    expect(empty.shortfall).toBe(3);

    // 给这门课新建一个题库 + 一道 easy 题，再抽一次
    db.run('INSERT INTO lessons (id, title, course_id) VALUES (9001, ?, 2)', ['组卷测试课时']);
    const quotaBank = db.run('INSERT INTO banks (name, lesson_id, kind) VALUES (?,9001,?)', [
      '配额自检题库',
      'lesson',
    ]).lastInsertRowid;
    db.run(
      'INSERT INTO questions (bank_id, lesson_id, type, stem, options, answer, difficulty) VALUES (?,9001,?,?,?,?,?)',
      [quotaBank, 'fill', '配额自检题', '[]', '1', 'easy'],
    );
    const filled = json<{ added: number; requested: number }>(
      await app.inject({
        method: 'POST',
        url: `/api/v1/exams/${created.id}/questions/random`,
        headers: { cookie },
        payload: { difficultyQuota: { easy: 1 } },
      }),
    );
    expect(filled.requested).toBe(1);
    expect(filled.added).toBe(1);

    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${created.id}/questions/random`,
      headers: { cookie },
      payload: { difficultyQuota: { whatever: 3 } },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('题库体检', () => {
  it('全库体检：元数据覆盖率、难度缺失、重复题与答案冲突', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/banks/health', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = json<{
      stats: { total: number; missingDifficulty: number; duplicateGroups: number; conflictGroups: number };
      metadata: { withSubject: number; withBook: number; withPoint: number; withHash: number };
      duplicates: { n: number; answers: number }[];
      kinds: { kind: string; questions: number }[];
    }>(res);
    expect(body.stats.total).toBeGreaterThanOrEqual(5);
    expect(body.stats.missingDifficulty).toBe(3); // 初始三个题库各自的第 1 题都没标难度
    expect(body.stats.duplicateGroups).toBe(1); // 三条同题干
    expect(body.stats.conflictGroups).toBe(1); // 其中两条答案不同
    expect(body.metadata.withSubject).toBeGreaterThanOrEqual(5);
    expect(body.metadata.withHash).toBeGreaterThanOrEqual(5);
    expect(body.duplicates[0]?.n).toBe(3);
    expect(body.kinds.map((k) => k.kind).sort()).toEqual(['chapter', 'lesson', 'paper']);
  });

  it('按题库体检只看该题库，并且需要教师/管理员权限', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/health?bankId=${paperBankId}`,
      headers: { cookie },
    });
    const body = json<{ scope: { name: string }; stats: { total: number; duplicateGroups: number } }>(res);
    expect(body.stats.total).toBe(1);
    expect(body.stats.duplicateGroups).toBe(0);
    expect(body.scope.name).toContain('期末测试卷A');

    const anon = await app.inject({ method: 'GET', url: '/api/v1/banks/health' });
    expect(anon.statusCode).toBe(401);
  });
});
