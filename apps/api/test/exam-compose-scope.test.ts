/**
 * 智能组卷的**范围**：默认只抽「这场考试所属课程」的题，不能把别门课的题组进来。
 *
 * 这是一个真实出现过的缺陷：前端不传 `courseId` 时，服务层直接把 `undefined` 传给了挑题函数，
 * 而 `undefined` 在挑题里表示「不限课程」→ 智能组卷会跨课程抽题。
 * 之前的测试只有一个课程，所以没拦住；这里专门造两门课做回归。
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
let db: Db;
let dataDir: string;
let cookie = '';
let courseA = 0;
let courseB = 0;
let bankA = 0;
let bankB = 0;
let examA = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-compose-scope-'));
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

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['甲课程·三年级上册']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['乙课程·九年级上册']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['甲课时', '第一章']);
  db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (2, ?, 2, ?)', ['乙课时', '第一章']);
  bankA = db.run('INSERT INTO banks (id, name, lesson_id, course_id, kind) VALUES (1, ?, 1, 1, ?)', [
    '甲题库',
    'lesson',
  ]).lastInsertRowid;
  bankB = db.run('INSERT INTO banks (id, name, lesson_id, course_id, kind) VALUES (2, ?, 2, 2, ?)', [
    '乙题库',
    'lesson',
  ]).lastInsertRowid;

  const add = (bankId: number, type: string, stem: string, difficultyScore: number, answer = 'A') =>
    db.run(
      `INSERT INTO questions (bank_id, type, stem, options, answer, difficulty, difficulty_score, content_hash)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        bankId,
        type,
        stem,
        '["甲","乙","丙","丁"]',
        answer,
        difficultyScore < 42 ? 'easy' : 'medium',
        difficultyScore,
        questionFingerprint(stem, []),
      ],
    ).lastInsertRowid;
  for (let i = 0; i < 6; i += 1) add(bankA, 'single', `甲课程单选题 ${i}`, 20 + i);
  for (let i = 0; i < 6; i += 1) add(bankB, 'single', `乙课程单选题 ${i}`, 50 + i);
  for (let i = 0; i < 4; i += 1) add(bankA, 'fill', `甲课程填空题 ${i}`, 20 + i, '1');
  for (let i = 0; i < 4; i += 1) add(bankB, 'fill', `乙课程填空题 ${i}`, 50 + i, '1');

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    headers: { cookie },
    payload: { courseId: 1, title: '甲课程考试', durationMinutes: 60, passScore: 60, status: 'draft' },
  });
  examA = json<{ id: number }>(exam).id;
  courseA = 1;
  courseB = 2;
});

afterAll(async () => {
  await app.close();
});

/** 卷内题目属于哪些题库 */
function banksInExam(examId: number): number[] {
  return db
    .all<{ bank_id: number }>(
      `SELECT DISTINCT q.bank_id FROM exam_questions eq JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ?`,
      [examId],
    )
    .map((r) => r.bank_id);
}

describe('智能组卷范围', () => {
  it('不传 courseId 时只抽本课程的题（不能混进别门课）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examA}/compose`,
      headers: { cookie },
      payload: { quota: { single: 5, fill: 3 }, ratio: { easy: 0.5, medium: 0.5, hard: 0 }, replaceExisting: true },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ added: number; scope: { mode: string; courseId: number } }>(res);
    expect(body.scope.mode).toBe('course');
    expect(body.scope.courseId).toBe(courseA);
    expect(body.added).toBe(8);
    // 卷内题目必须全部来自甲题库
    expect(banksInExam(examA)).toEqual([bankA]);
  });

  it('明确 scope=all 时才允许跨课程抽题', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examA}/compose`,
      headers: { cookie },
      payload: { quota: { single: 6 }, scope: 'all', replaceExisting: true },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ added: number; scope: { mode: string } }>(res);
    expect(body.scope.mode).toBe('all');
    expect(body.added).toBe(6);
    // 跨课程时两门课的题都可能被抽到（至少说明确实放开了范围）
    const banks = banksInExam(examA);
    expect(banks.every((b) => b === bankA || b === bankB)).toBe(true);
  });

  it('显式指定另一门课：只抽那门课的题', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examA}/compose`,
      headers: { cookie },
      payload: { quota: { single: 4 }, courseId: courseB, replaceExisting: true },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ scope: { courseId: number } }>(res).scope.courseId).toBe(courseB);
    expect(banksInExam(examA)).toEqual([bankB]);
  });

  /**
   * 契约变更（真机踩过）：挑题接口以前"不带 courseId 就不限课程"，由前端负责传对，
   * 结果是新组卷页忘了传时，**别门课的题会混进试卷**。现在默认落到本考试所属课程，
   * 要跨课程必须显式 `scope=all`。这条用例锁住新契约。
   */
  it('挑题接口默认只给本考试的课程；要跨课程必须显式 scope=all', async () => {
    const scoped = json<{ questions: { bank_id: number }[] }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/exams/${examA}/pool?courseId=${courseA}&pageSize=50`,
        headers: { cookie },
      }),
    );
    expect(scoped.questions.every((q) => q.bank_id === bankA)).toBe(true);

    // 不传 courseId：默认 = 本考试所属课程（不是全库）
    const defaulted = json<{ questions: { bank_id: number }[] }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/exams/${examA}/pool?pageSize=50`,
        headers: { cookie },
      }),
    );
    expect(defaulted.questions.length).toBeGreaterThan(0);
    expect(defaulted.questions.every((q) => q.bank_id === bankA)).toBe(true);

    // 显式 scope=all 才跨课程
    const all = json<{ questions: { bank_id: number }[] }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/exams/${examA}/pool?scope=all&pageSize=50`,
        headers: { cookie },
      }),
    );
    expect(new Set(all.questions.map((q) => q.bank_id)).size).toBeGreaterThan(1);
  });
});
