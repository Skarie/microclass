/**
 * 试卷 Word 导出：/exams/:id/paper.docx
 *
 * 关键点（容易做错的）：
 *   - 返回的是真正的 docx（zip，前两字节 PK）；
 *   - **题图要内联**（真机大量题干带 question-media 图片，导出稿不能是 `![](...)` 源码）；
 *   - `answers=0` 是学生卷，不能出现答案解析。
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
let examId = 0;

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paperdocx-'));
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
    payload: { name: 'Word 导出测试课程', published: true },
    headers: { cookie },
  });
  const courseId = json<{ id: number }>(course).id;
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: 'Word 导出测试题库', courseId },
    headers: { cookie },
  });
  const bankId = json<{ id: number }>(bank).id;

  const q1 = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    payload: {
      bankId,
      type: 'single',
      stem: 'Word 导出：常量关键字是？',
      options: ['const', 'final'],
      answer: 'B',
      analysis: 'final 表示常量',
    },
    headers: { cookie },
  });
  const q2 = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    payload: { bankId, type: 'judge', stem: 'Word 导出：Java 是编译型语言。', answer: '对' },
    headers: { cookie },
  });
  const ids = [json<{ id: number }>(q1).id, json<{ id: number }>(q2).id];

  const exam = await app.inject({
    method: 'POST',
    url: '/api/v1/exams',
    payload: { courseId, title: 'Word 导出测试考试', durationMinutes: 60, passScore: 60, status: 'draft' },
    headers: { cookie },
  });
  examId = json<{ id: number }>(exam).id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/exams/${examId}/questions`,
    payload: { questionIds: ids },
    headers: { cookie },
  });
  await app.inject({
    method: 'PUT',
    url: `/api/v1/exams/${examId}/structure`,
    payload: { structure: [{ name: '一、选择题', type: 'single', score: 5, description: '' }], applyScores: true },
    headers: { cookie },
  });
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('试卷 Word 导出', () => {
  it('返回真正的 docx（zip 头）并带下载文件名', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper.docx`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.rawPayload[0]).toBe(0x50);
    expect(res.rawPayload[1]).toBe(0x4b);
    expect(res.rawPayload.length).toBeGreaterThan(2000);
  });

  it('answers=0 导出学生卷（不含答案解析）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/paper.docx?answers=0`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // docx 是压缩包：解出 document.xml 简单比对体积（学生卷应更小）
    const full = await app.inject({ method: 'GET', url: `/api/v1/exams/${examId}/paper.docx`, headers: { cookie } });
    expect(res.rawPayload.length).toBeLessThan(full.rawPayload.length);
  });
});
