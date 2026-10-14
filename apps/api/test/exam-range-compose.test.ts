/**
 * 按「章节 / 知识点范围」随机组卷（老师：先圈范围 → 再按题型数量随机抽）。
 *
 * 要挡住的问题：范围参数被丢掉 → 随机卷里混进**范围外**的题（用户明确抱怨过这种）。
 * 所以断言不看"抽了几道"，而是看**抽到的每一道题是否都在所选范围内**。
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
/** 章节 → 该章节知识点 → 题目 id，用来核对"抽到的题是否在范围内" */
const byChapter = new Map<string, Map<string, number[]>>();

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

async function makeQuestion(
  bankId: number,
  spec: { type: string; chapter: string; point: string; stem: string },
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    payload: {
      bankId,
      type: spec.type,
      stem: spec.stem,
      answer: spec.type === 'single' ? 'A' : spec.type === 'judge' ? '对' : 'x',
      ...(spec.type === 'single' ? { options: ['A', 'B'] } : {}),
      chapter: spec.chapter,
      point: spec.point,
      difficulty: 'medium',
    },
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-range-'));
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

  const course = await app.inject({
    method: 'POST',
    url: '/api/v1/courses',
    payload: { name: '范围组卷课程', published: true },
    headers: { cookie },
  });
  courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '范围组卷题库', courseId },
    headers: { cookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  // 两个章节，每章两个知识点，每个知识点下 4 道单选 + 2 道判断
  for (const chapter of ['第一章 加与减', '第二章 乘法']) {
    const points = new Map<string, number[]>();
    for (const point of [`${chapter}-知识点A`, `${chapter}-知识点B`]) {
      const ids: number[] = [];
      for (let i = 0; i < 4; i += 1)
        ids.push(await makeQuestion(bankId, { type: 'single', chapter, point, stem: `${point} 单选 ${i}` }));
      for (let i = 0; i < 2; i += 1)
        ids.push(await makeQuestion(bankId, { type: 'judge', chapter, point, stem: `${point} 判断 ${i}` }));
      points.set(point, ids);
    }
    byChapter.set(chapter, points);
  }

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: '范围组卷测试', durationMinutes: 30, passScore: 60, status: 'draft' },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** 组装"范围内合法题目 id"集合 */
function allowedIds(chapters: string[], points: string[]): Set<number> {
  const allow = new Set<number>();
  for (const [chapter, pointMap] of byChapter) {
    if (chapters.length > 0 && !chapters.includes(chapter)) continue;
    for (const [point, ids] of pointMap) {
      if (points.length > 0 && !points.includes(point)) continue;
      for (const id of ids) allow.add(id);
    }
  }
  return allow;
}

describe('按范围随机组卷', () => {
  it('只勾单个章节：抽到的题全在该章节内（按题型数量）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: {
        quota: { single: 5, judge: 3 },
        chapters: ['第二章 乘法'],
        replaceExisting: true,
      },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<{ added: number }>(res);
    expect(result.added).toBe(8);

    const paper = json<{ questions: { id: number; type: string }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } }),
    );
    const allow = allowedIds(['第二章 乘法'], []);
    for (const q of paper.questions) {
      expect(allow.has(q.id), `抽到了范围外的题 ${q.id}`).toBe(true);
    }
    expect(paper.questions.filter((q) => q.type === 'single')).toHaveLength(5);
    expect(paper.questions.filter((q) => q.type === 'judge')).toHaveLength(3);
  });

  it('跨章节 + 指定知识点：两条规则同时生效', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: {
        quota: { single: 4 },
        // 跨两个章节，但只取每章的"知识点A"
        chapters: ['第一章 加与减', '第二章 乘法'],
        points: ['第一章 加与减-知识点A', '第二章 乘法-知识点A'],
        scores: { single: 3.5 },
        replaceExisting: true,
      },
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);

    const paper = json<{ questions: { id: number; score: number }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper`, headers: { cookie } }),
    );
    const allow = allowedIds(['第一章 加与减', '第二章 乘法'], ['第一章 加与减-知识点A', '第二章 乘法-知识点A']);
    expect(paper.questions).toHaveLength(4);
    for (const q of paper.questions) {
      expect(allow.has(q.id), `抽到了范围外的题 ${q.id}`).toBe(true);
      // 分值按题型落盘
      expect(q.score).toBe(3.5);
    }
  });

  it('范围里题量不够时如实报缺口', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: { quota: { single: 50 }, chapters: ['第二章 乘法'], replaceExisting: true },
      headers: { cookie },
    });
    const result = json<{ added: number; shortfall: number; detail: { missing: number }[] }>(res);
    // 第二章只有 8 道单选（2 知识点 × 4）
    expect(result.added).toBe(8);
    expect(result.shortfall).toBe(42);
    expect(result.detail.some((d) => d.missing === 42)).toBe(true);
  });

  it('完全不传范围时仍是"本课程全范围"（不会因为没传就跨课程）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/exams/${examId}/compose`,
      payload: { quota: { single: 3 }, replaceExisting: true },
      headers: { cookie },
    });
    const result = json<{ scope: { mode: string; courseId: number } }>(res);
    expect(result.scope.mode).toBe('course');
    expect(result.scope.courseId).toBe(courseId);
  });
});
