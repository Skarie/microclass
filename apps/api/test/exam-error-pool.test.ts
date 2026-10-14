/**
 * 易错题挑题：`GET /exams/:id/pool?orderBy=error_desc`
 *
 * 真机情形：大量题只有 1 次作答，直接按错误率排会把噪声顶上第一屏。
 * 这里用构造的作答数据验证：① 默认过滤掉样本不足的题；② 排序按威尔逊下界（证据足者优先）；
 * ③ 普通模式也返回错率，界面可以显示「错率 67%（3 次）」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';
let courseId = 0;
let examId = 0;
let bankId = 0;
const ids = new Map<string, number>();

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

/** 造一条练习作答记录（answers 与真实写入结构一致：`[{qid,answer,correct}]`） */
function addAttempt(lessonId: number, items: { qid: number; correct: boolean | null }[]): void {
  db.run('INSERT INTO attempts (client_id, lesson_id, answers, score, total) VALUES (?,?,?,?,?)', [
    'test-client',
    lessonId,
    JSON.stringify(items.map((i) => ({ qid: i.qid, answer: 'x', correct: i.correct }))),
    items.filter((i) => i.correct === true).length,
    items.length,
  ]);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-errorpool-'));
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

  const course = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '易错题测试课程', published: true },
    headers: { cookie },
  });
  courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '易错题测试题库', courseId },
    headers: { cookie },
  });
  bankId = json<{ id: number }>(bank).id;

  for (const stem of ['易错-证据足的题', '易错-单样本噪声题', '易错-全对的题', '易错-没作答的题']) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      payload: { bankId, type: 'single', stem, options: ['A', 'B'], answer: 'A' },
      headers: { cookie },
    });
    ids.set(stem, json<{ id: number }>(res).id);
  }

  // 需要一个课时才能写 attempts（lesson_id 外键）
  const lesson = await app.inject({
    method: 'POST',
    url: '/api/v1/lessons',
    payload: { title: '易错题测试课时', videoKind: 'url', videoPath: 'https://example.com/x.mp4', courseId },
    headers: { cookie },
  });
  const lessonId = json<{ id: number }>(lesson).id;

  // 证据足：20 次作答错 12 次（错误率 60%，威尔逊下界 ≈0.37）
  for (let i = 0; i < 12; i += 1) addAttempt(lessonId, [{ qid: ids.get('易错-证据足的题')!, correct: false }]);
  for (let i = 0; i < 8; i += 1) addAttempt(lessonId, [{ qid: ids.get('易错-证据足的题')!, correct: true }]);
  // 单样本噪声：1 次错 1 次（原始错误率 100%，威尔逊下界 ≈0.21）
  addAttempt(lessonId, [{ qid: ids.get('易错-单样本噪声题')!, correct: false }]);
  // 全对：5 次全对（下界 0）
  for (let i = 0; i < 5; i += 1) addAttempt(lessonId, [{ qid: ids.get('易错-全对的题')!, correct: true }]);
  // 主观题（correct=null）不应计入：给证据足的题再插 3 条 null
  for (let i = 0; i < 3; i += 1) addAttempt(lessonId, [{ qid: ids.get('易错-证据足的题')!, correct: null }]);

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: '易错题测试考试', durationMinutes: 45, passScore: 60, status: 'draft' },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('易错题挑题（按真实作答错误率）', () => {
  it('主观题（correct=null）不计入错误率', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&orderBy=error_desc&minAttempts=1&pageSize=20`,
      headers: { cookie },
    });
    const row = json<{ questions: { id: number; attempts: number; wrong: number }[] }>(res).questions.find(
      (q) => q.id === ids.get('易错-证据足的题'),
    );
    // 20 次客观题作答（12 错）+ 3 条主观题被排除
    expect(row?.attempts).toBe(20);
    expect(row?.wrong).toBe(12);
  });

  it('默认过滤样本不足的题：单样本噪声题（1 次）不出现在易错榜里', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&orderBy=error_desc&pageSize=20`,
      headers: { cookie },
    });
    const body = json<{ minAttempts: number; questions: { id: number }[] }>(res);
    expect(body.minAttempts).toBe(2);
    const list = body.questions.map((q) => q.id);
    expect(list).not.toContain(ids.get('易错-单样本噪声题'));
    expect(list).not.toContain(ids.get('易错-没作答的题'));
    expect(list).toContain(ids.get('易错-证据足的题'));
  });

  it('排序按威尔逊下界：证据足的题排在单样本题前面（minAttempts=1 时也一样）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&orderBy=error_desc&minAttempts=1&pageSize=20`,
      headers: { cookie },
    });
    const list = json<{ questions: { id: number; error_rate: number; attempts: number }[] }>(res).questions;
    const solid = list.findIndex((q) => q.id === ids.get('易错-证据足的题'));
    const noisy = list.findIndex((q) => q.id === ids.get('易错-单样本噪声题'));
    expect(noisy).toBeGreaterThanOrEqual(0);
    expect(solid).toBeGreaterThanOrEqual(0);
    expect(solid).toBeLessThan(noisy);
  });

  it('普通模式也返回错率与作答次数（界面可直接显示「错率 60%（20 次）」）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/pool?courseId=${courseId}&pageSize=20`,
      headers: { cookie },
    });
    const row = json<{ questions: { id: number; attempts: number; error_rate: number }[] }>(res).questions.find(
      (q) => q.id === ids.get('易错-证据足的题'),
    );
    expect(row?.attempts).toBe(20);
    expect(row?.error_rate).toBeCloseTo(0.6, 2);
  });
});
