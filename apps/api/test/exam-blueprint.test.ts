/**
 * 组卷能力（对标智学网的核心缺口）集成测试：
 *   ① 双向细目表作为组卷输入（知识点 × 题型 × 难度 逐格配题 + 缺口如实报告）
 *   ② 换题候选列表 + 按指定候选换题
 *   ③ 细目表参考数据（题池里每个知识点各有多少可选题）
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
/** 题干 → 题 id，便于断言"配到的是哪几道" */
const ids = new Map<string, number>();

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-blueprint-'));
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
    payload: { name: '细目表测试课程', published: true },
    headers: { cookie },
  });
  courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '细目表测试题库', courseId },
    headers: { cookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  /**
   * 造题：4 道「分数」+ 2 道「方程」，覆盖三种难度与不同题型。
   * 知识点与难度分需要直接写库（建题接口没有这两个字段）。
   */
  // 各题型的答案格式不同：单选填字母、判断填 对/错、填空填文本
  const specs: { stem: string; type: string; point: string; score: number; answer: string }[] = [
    { stem: '分数易题甲', type: 'single', point: '分数', score: 30, answer: 'A' },
    { stem: '分数易题乙', type: 'single', point: '分数', score: 35, answer: 'B' },
    { stem: '分数中题甲', type: 'fill', point: '分数', score: 55, answer: '二分之一' },
    { stem: '分数难题甲', type: 'single', point: '分数', score: 80, answer: 'C' },
    { stem: '方程易题甲', type: 'single', point: '方程', score: 25, answer: 'A' },
    { stem: '方程易题乙', type: 'judge', point: '方程', score: 20, answer: '对' },
  ];
  for (const spec of specs) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      payload: { bankId, type: spec.type, stem: spec.stem, options: ['A', 'B', 'C', 'D'], answer: spec.answer },
      headers: { cookie },
    });
    expect(res.statusCode, `建题失败：${res.body}`).toBe(200);
    const id = json<{ id: number }>(res).id;
    ids.set(spec.stem, id);
    db.run('UPDATE questions SET point = ?, difficulty_score = ? WHERE id = ?', [spec.point, spec.score, id]);
  }

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: '细目表测试考试', durationMinutes: 60, passScore: 60, status: 'draft' },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('双向细目表作为组卷输入', () => {
  it('按「知识点 × 题型 × 难度」逐格配题，并如实报告缺口与题池可用量', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: {
        cells: [
          { point: '分数', type: 'single', level: 'easy', count: 2 },
          { point: '方程', type: 'single', level: 'easy', count: 1 },
          // 题池里不存在的一格：要如实报缺口，不能静默少配
          { point: '几何', type: 'fill', level: 'hard', count: 2 },
        ],
      },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      added: number;
      requested: number;
      shortfall: number;
      cells: {
        point: string;
        type: string;
        level: string;
        requested: number;
        added: number;
        missing: number;
        available: number;
      }[];
    }>(res);

    expect(body.requested).toBe(5);
    expect(body.added).toBe(3);
    expect(body.shortfall).toBe(2);

    const fenEasy = body.cells.find((c) => c.point === '分数' && c.type === 'single' && c.level === 'easy');
    expect(fenEasy).toMatchObject({ requested: 2, added: 2, missing: 0, available: 2 });
    const fangEasy = body.cells.find((c) => c.point === '方程' && c.level === 'easy');
    expect(fangEasy).toMatchObject({ requested: 1, added: 1, missing: 0 });
    const missing = body.cells.find((c) => c.point === '几何');
    expect(missing).toMatchObject({ requested: 2, added: 0, missing: 2, available: 0 });

    // 配到的必须是「分数 · 单选 · 易」那两道，且不重复
    const paper = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } });
    const qids = json<{ questions: { id: number }[] }>(paper).questions.map((q) => q.id);
    expect(qids).toHaveLength(3);
    expect(new Set(qids).size).toBe(3);
    expect(qids).toContain(ids.get('分数易题甲'));
    expect(qids).toContain(ids.get('分数易题乙'));
    expect(qids).toContain(ids.get('方程易题甲'));
  });

  it('细目表与「题型配额」不能同时用（避免语义打架）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: { quota: { single: 2 }, cells: [{ point: '分数', type: 'single', level: 'easy', count: 1 }] },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('二选一');
  });

  it('细目表格式错误会被拒绝（不静默丢弃）', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: { cells: [{ point: '分数', type: 'essay', level: 'easy', count: 1 }] },
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: { cells: [] },
      headers: { cookie },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('参考数据（taxonomy）给出每个知识点的 题型 × 难度 可选题量', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/taxonomy`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      scope: { mode: string; courseId: number | undefined };
      total: number;
      points: { point: string; total: number; cells: { type: string; easy: number; medium: number; hard: number }[] }[];
    }>(res);
    expect(body.scope.mode).toBe('course');
    expect(body.scope.courseId).toBe(courseId);

    const fen = body.points.find((p) => p.point === '分数');
    expect(fen?.total).toBe(4);
    const singleCell = fen?.cells.find((c) => c.type === 'single');
    expect(singleCell).toMatchObject({ easy: 2, hard: 1, medium: 0 });
    const fillCell = fen?.cells.find((c) => c.type === 'fill');
    expect(fillCell).toMatchObject({ medium: 1 });
  });
});

describe('相似题换题（候选列表 + 指定换题）', () => {
  it('候选按匹配强度分组，排除已在卷内的题', async () => {
    const qid = ids.get('分数易题甲');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/questions/${qid}/candidates?limit=5`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      current: { id: number; point: string };
      groups: { reason: string; candidates: { id: number; point: string; levelDelta: number }[] }[];
    }>(res);
    expect(body.current.id).toBe(qid);
    expect(body.current.point).toBe('分数');
    expect(body.groups.length).toBeGreaterThan(0);
    const all = body.groups.flatMap((g) => g.candidates).map((c) => c.id);
    expect(all.length).toBeGreaterThan(0);
    // 已在卷内的题不能作为候选（否则换上去就重复了）
    expect(all).not.toContain(ids.get('分数易题乙'));
    expect(all).not.toContain(ids.get('方程易题甲'));
    // 同题型优先：候选里不应出现判断题
    const types = new Set(
      body.groups
        .flatMap((g) => g.candidates)
        .map((c) => db.get<{ type: string }>('SELECT type FROM questions WHERE id = ?', [c.id])?.type),
    );
    expect(types.has('judge')).toBe(false);
  });

  it('按指定候选换题：换上的正是挑中的那道', async () => {
    const from = ids.get('分数易题甲');
    const to = ids.get('分数难题甲');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions/${from}/replace`,
      payload: { withId: to },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const paper = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } });
    const qids = json<{ questions: { id: number }[] }>(paper).questions.map((q) => q.id);
    expect(qids).toContain(to);
    expect(qids).not.toContain(from);
  });

  it('拒绝把已在卷内的题换进来；不存在的题返回 404', async () => {
    const inExam = ids.get('分数难题甲');
    const another = ids.get('方程易题甲');
    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions/${another}/replace`,
      payload: { withId: inExam },
      headers: { cookie },
    });
    expect(dup.statusCode).toBe(400);

    const ghost = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions/${another}/replace`,
      payload: { withId: 999999 },
      headers: { cookie },
    });
    expect(ghost.statusCode).toBe(404);
  });
});

describe('题库归属课程（回归：create 曾经忽略 courseId）', () => {
  it('建题库时显式指定归属课程必须落库，否则组卷题池搜不到它', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      payload: { name: '只指定课程不挂课时的题库', courseId },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const bankId = json<{ id: number }>(res).id;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/banks/${bankId}`, headers: { cookie } });
    const bank = json<{ bank: { course_id: number | null } } | { course_id: number | null }>(detail);
    const courseIdOf = 'bank' in bank ? bank.bank.course_id : bank.course_id;
    expect(courseIdOf).toBe(courseId);
  });
});
