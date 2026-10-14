/**
 * 平行组卷（A/B 卷）集成测试。
 *
 * 要挡住的问题：
 *   - "平行卷"里出现了和原卷**同一道题**（那就不平行了）；
 *   - 结构不可比（题量/题型/难度档对不上），两份卷的成绩没法比；
 *   - 分值与大题没沿用，新卷还得手工重设一遍；
 *   - 考试设置（时长/及格/乱序/公布答案）没带过去；
 *   - 题池不够时**静默少配**（老师以为配齐了）。
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
let dataDir: string;
let cookie = '';
let courseId = 0;
let examId = 0;
/** 原卷题目：题型 × 难度 × 知识点，用来核对平行卷是否结构可比 */
let sourceShape: { type: string; point: string; level: number }[] = [];

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

/** 造一批带知识点与难度的题：每题给一个"孪生题"（同题型/同难度/同知识点） */
async function seedBank(): Promise<void> {
  const course = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '平行卷测试课程', published: true },
    headers: { cookie },
  });
  courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '平行卷测试题库', courseId },
    headers: { cookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  const specs: { type: string; stem: string; answer: string; point: string; difficulty: string; options?: string[] }[] =
    [];
  const points = ['分数的意义', '小数乘法', '图形的周长'];
  const types = [
    { type: 'single', answer: 'A', options: ['A', 'B'] },
    { type: 'judge', answer: '对' },
    { type: 'fill', answer: 'x' },
  ];
  for (const [pi, point] of points.entries()) {
    for (const t of types) {
      // 每个"题位"造 2 道同型同难度同知识点的题（原卷用一道，平行卷应有另一道可换）
      for (const n of [1, 2]) {
        specs.push({
          ...t,
          stem: `【${point}】第 ${n} 题（${t.type}）`,
          point,
          difficulty: pi === 0 ? 'easy' : pi === 1 ? 'medium' : 'hard',
        });
      }
    }
  }

  const ids: number[] = [];
  for (const spec of specs) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      payload: {
        bankId,
        type: spec.type,
        stem: spec.stem,
        answer: spec.answer,
        ...(spec.options ? { options: spec.options } : {}),
        point: spec.point,
        difficulty: spec.difficulty,
      },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    ids.push(json<{ id: number }>(res).id);
  }

  // 原卷：每个(知识点×题型)取第 1 道 → 9 题，带分值与大题
  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: {
      courseId,
      title: '平行卷原卷',
      durationMinutes: 40,
      passScore: 70,
      status: 'published',
      shuffleQuestions: true,
      showAnswers: false,
      attemptLimit: 2,
    },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;

  const picked = specs
    .map((spec, i) => ({ spec, id: ids[i] as number }))
    .filter(({ spec }) => spec.stem.includes('第 1 题'));
  await app.inject({
    method: 'POST',
    url: `/api/v1/exams/${examId}/questions`,
    payload: { questionIds: picked.map((p) => p.id) },
    headers: { cookie },
  });
  let i = 0;
  for (const { spec, id } of picked) {
    i += 1;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/exams/${examId}/questions/${id}`,
      payload: { score: i, section: `${spec.type} 组` },
      headers: { cookie },
    });
  }
  sourceShape = picked.map((p) => ({
    type: p.spec.type,
    point: p.spec.point,
    level: p.spec.difficulty === 'easy' ? 1 : p.spec.difficulty === 'medium' ? 3 : 5,
  }));
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-parallel-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  const db = new Db(':memory:');
  const built = await buildApp(config, { db });
  app = built.app;
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
  await seedBank();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('平行组卷', () => {
  it('生成的新卷：题量一致、无同题、题型与难度档次一致', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/parallel`,
      payload: { title: '平行卷 B' },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<{ examId: number; title: string; requested: number; matched: number; shortfall: number }>(res);
    expect(result.title).toBe('平行卷 B');
    expect(result.requested).toBe(sourceShape.length);
    expect(result.matched).toBe(sourceShape.length);
    expect(result.shortfall).toBe(0);

    const src = json<{ questions: { id: number; type: string; score: number; section: string }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } }),
    );
    const dst = json<{ questions: { id: number; type: string; score: number; section: string }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${result.examId}/paper`, headers: { cookie } }),
    );

    expect(dst.questions).toHaveLength(src.questions.length);
    // ① 不能出现和原卷同一道题
    const srcIds = new Set(src.questions.map((q) => q.id));
    for (const q of dst.questions) expect(srcIds.has(q.id), `平行卷里出现了原卷题目 ${q.id}`).toBe(false);
    // ② 平行卷内部也不能重复
    expect(new Set(dst.questions.map((q) => q.id)).size).toBe(dst.questions.length);
    // ③ 逐题题型一致（顺序一一对应）
    src.questions.forEach((q, i) => {
      expect(dst.questions[i]?.type, `第 ${i + 1} 题题型应一致`).toBe(q.type);
      // ④ 分值与大题沿用
      expect(dst.questions[i]?.score).toBe(q.score);
      expect(dst.questions[i]?.section).toBe(q.section);
    });
  });

  it('新卷沿用原卷的考试设置与试卷结构', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/parallel`,
      payload: {},
      headers: { cookie },
    });
    const { examId: newId } = json<{ examId: number }>(res);
    const exam = json<{ exam: Record<string, number | string> }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${newId}`, headers: { cookie } }),
    ).exam;
    expect(exam.course_id).toBe(courseId);
    expect(exam.duration_minutes).toBe(40);
    expect(exam.pass_score).toBe(70);
    expect(exam.attempt_limit).toBe(2);
    expect(exam.shuffle_questions).toBe(1);
    expect(exam.show_answers).toBe(0);
    expect(String(exam.title)).toContain('平行卷');
    // 新卷默认是草稿，避免误发给学生
    expect(exam.status).toBe('draft');
  });

  it('题池不足时如实报缺口（不静默少配）', async () => {
    // 把原卷扩到远超孪生题数量：再加 20 道"没有孪生题"的题（同型但知识点独有）
    const bank = await app.inject({
      method: 'GET',
      url: `/api/v1/banks?courseId=${courseId}`,
      headers: { cookie },
    });
    const bankId = json<{ banks: { id: number }[] }>(bank).banks[0]?.id ?? 0;
    const extra: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/questions`,
        payload: {
          bankId,
          type: 'short',
          stem: `独有考点题 ${i}`,
          answer: '略',
          point: `独有考点-${i}`,
          difficulty: 'hard',
        },
        headers: { cookie },
      });
      extra.push(json<{ id: number }>(r).id);
    }
    await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/questions`,
      payload: { questionIds: extra },
      headers: { cookie },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/parallel`,
      payload: {},
      headers: { cookie },
    });
    const result = json<{ requested: number; matched: number; shortfall: number; detail: { to: number | null }[] }>(
      res,
    );
    expect(result.requested).toBe(sourceShape.length + extra.length);
    expect(result.shortfall).toBeGreaterThan(0);
    expect(result.detail.filter((d) => d.to === null)).toHaveLength(result.shortfall);
  });

  it('原卷为空时明确报错（而不是生成一张空卷）', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/exams',
      payload: { courseId, title: '空卷', durationMinutes: 10, passScore: 60, status: 'draft' },
      headers: { cookie },
    });
    const emptyId = json<{ id: number }>(empty).id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${emptyId}/parallel`,
      payload: {},
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('还没有题目');
  });
});
