/**
 * 题目章节 / 小节（迁移 0025）：
 *   - 单题创建 / 编辑的 trim 与长度；
 *   - 题目列表按 chapter / section 过滤；
 *   - 批量改章节 / 小节（只影响本库、空串清空、权限）；
 *   - CSV / Markdown / manifest 三种导入都支持可选字段。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface QuestionRow {
  id: number;
  stem: string;
  chapter: string;
  section: string;
}

let app: FastifyInstance;
let dataDir: string;
let db: Db;
let adminCookie = '';
let studentCookie = '';
let bankId = 0;
let otherBankId = 0;
let q1 = 0;
let q2 = 0;
let q3 = 0;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function createBank(name: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    headers: { cookie: adminCookie },
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return json<{ id: number }>(res).id;
}

async function createQuestion(targetBankId: number, payload: Record<string, unknown>): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${targetBankId}/questions`,
    headers: { cookie: adminCookie },
    payload: { bankId: targetBankId, type: 'fill', answer: '答案', ...payload },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

async function listQuestions(targetBankId: number, query = ''): Promise<QuestionRow[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/banks/${targetBankId}/questions${query}`,
    headers: { cookie: adminCookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ questions: QuestionRow[] }>(res).questions;
}

function multipartFile(filename: string, data: string, contentType = 'text/plain'): { body: Buffer; type: string } {
  const boundary = '----mc-sections-boundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      'utf8',
    ),
    Buffer.from(data, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

async function importFile(filename: string, data: string, contentType = 'text/plain'): Promise<void> {
  const file = multipartFile(filename, data, contentType);
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/import`,
    headers: { cookie: adminCookie, 'content-type': file.type },
    payload: file.body,
  });
  expect(res.statusCode, res.body).toBe(200);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-question-sections-'));
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
  adminCookie = await login('admin', 'admin123');

  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'section_student', password: 'pass1234' },
  });
  studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

  bankId = await createBank('章节测试题库');
  otherBankId = await createBank('另一个题库');
  q1 = await createQuestion(bankId, { stem: '第一题', chapter: '  第一章  ', section: '  1.1  ', sort: 1 });
  q2 = await createQuestion(bankId, { stem: '第二题', chapter: '第一章', section: '1.2', sort: 2 });
  q3 = await createQuestion(bankId, { stem: '第三题', chapter: '', section: '', sort: 3 });
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('单题章节 / 小节的 CRUD 与列表过滤', () => {
  it('创建时 trim，未传时为空串；详情返回 section', async () => {
    expect((await listQuestions(bankId)).find((q) => q.id === q1)).toMatchObject({
      chapter: '第一章',
      section: '1.1',
    });
    const empty = (await listQuestions(bankId)).find((q) => q.id === q3);
    expect(empty).toMatchObject({ chapter: '', section: '' });

    const res = await app.inject({ method: 'GET', url: `/api/v1/questions/${q1}`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(json<{ question: QuestionRow }>(res).question).toMatchObject({ chapter: '第一章', section: '1.1' });

    // 超长按 120 截断，不在入口 400
    const longId = await createQuestion(bankId, {
      stem: '超长章节题目',
      chapter: '章'.repeat(200),
      section: '节'.repeat(200),
    });
    const long = (await listQuestions(bankId)).find((q) => q.id === longId);
    expect(long?.chapter).toHaveLength(120);
    expect(long?.section).toHaveLength(120);
  });

  it('列表按 chapter / section 精确过滤（空串筛选未分章）', async () => {
    expect((await listQuestions(bankId, '?chapter=第一章&section=1.1')).map((q) => q.id)).toEqual([q1]);
    expect((await listQuestions(bankId, '?chapter=第一章')).map((q) => q.id).sort()).toEqual([q1, q2].sort());
    expect((await listQuestions(bankId, '?section=1.2')).map((q) => q.id)).toEqual([q2]);
    expect((await listQuestions(bankId, '?chapter=')).map((q) => q.id)).toContain(q3);
  });

  it('PUT 单题可改章节 / 小节', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${q3}`,
      headers: { cookie: adminCookie },
      payload: { bankId, type: 'fill', stem: '第三题', answer: '答案', chapter: '第二章', section: '2.1' },
    });
    expect(res.statusCode).toBe(200);
    expect((await listQuestions(bankId)).find((q) => q.id === q3)).toMatchObject({
      chapter: '第二章',
      section: '2.1',
    });
  });
});

describe('批量改章节 / 小节', () => {
  it('只更新本库题目，返回 updated；空串清空指定字段', async () => {
    const other = await createQuestion(otherBankId, { stem: '别的库题目', chapter: '别的章', section: '别的节' });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/${bankId}/questions/sections`,
      headers: { cookie: adminCookie },
      payload: { ids: [q1, q2, other], chapter: '第三章', section: '3.1' },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ updated: number }>(res).updated).toBe(2);
    const rows = await listQuestions(bankId, '?chapter=第三章&section=3.1');
    expect(rows.map((q) => q.id).sort()).toEqual([q1, q2].sort());

    const otherRow = await app.inject({
      method: 'GET',
      url: `/api/v1/questions/${other}`,
      headers: { cookie: adminCookie },
    });
    expect(json<{ question: QuestionRow }>(otherRow).question).toMatchObject({ chapter: '别的章', section: '别的节' });

    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/${bankId}/questions/sections`,
      headers: { cookie: adminCookie },
      payload: { ids: [q1], chapter: '' },
    });
    expect(json<{ updated: number }>(clear).updated).toBe(1);
    expect((await listQuestions(bankId)).find((q) => q.id === q1)).toMatchObject({ chapter: '', section: '3.1' });
  });

  it('chapter / section 都不传 400；学生 403', async () => {
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/${bankId}/questions/sections`,
      headers: { cookie: adminCookie },
      payload: { ids: [q2] },
    });
    expect(bad.statusCode).toBe(400);

    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/v1/banks/${bankId}/questions/sections`,
      headers: { cookie: studentCookie },
      payload: { ids: [q2], chapter: 'x' },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('导入支持 chapter / section', () => {
  it('CSV：有章节/小节列时写入，没有则留空', async () => {
    const csv = [
      '题型,题干,选项A,选项B,答案,解析,章节,小节',
      '单选题,CSV 章节题,甲,乙,A,,导入章,导入节',
      ['判断题', 'CSV 无章节题', '', '', '对', '', '', ''].join(','),
    ].join('\n');
    await importFile('章节.csv', csv, 'text/csv');
    expect((await listQuestions(bankId, '?chapter=导入章&section=导入节')).map((q) => q.stem)).toEqual(['CSV 章节题']);
    expect((await listQuestions(bankId, '?chapter=')).some((q) => q.stem === 'CSV 无章节题')).toBe(true);
  });

  it('Markdown：「章节：」「小节：」行被解析', async () => {
    const md = ['### 1. 单选题', 'Markdown 章节题', 'A. 甲', 'B. 乙', '章节：导入章', '小节：导入节', '答案：A'].join(
      '\n',
    );
    await importFile('章节.md', md, 'text/markdown');
    expect((await listQuestions(bankId, '?chapter=导入章&section=导入节')).map((q) => q.stem)).toContain(
      'Markdown 章节题',
    );
  });

  it('manifest：chapter / section 字段落库', async () => {
    const boundary = '----mc-manifest-boundary';
    const manifest = JSON.stringify({
      questions: [{ type: 'short', stem: 'Manifest 章节题', answer: '参考', chapter: '导入章', section: '导入节' }],
    });
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${manifest}\r\n--${boundary}--\r\n`,
      'utf8',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      headers: {
        cookie: adminCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ inserted: number }>(res).inserted).toBe(1);
    expect((await listQuestions(bankId, '?chapter=导入章&section=导入节')).map((q) => q.stem)).toContain(
      'Manifest 章节题',
    );
  });
});
