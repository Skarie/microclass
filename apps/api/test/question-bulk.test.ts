/**
 * 批量接口的 API 测试：
 *   - 批量改难度：写 manual 来源、只影响该题库的题、跳过不存在的 id
 *   - 批量删除：只删该题库的题、同步题库题量、跳过跨库 id
 *   - 参数校验：空数组 / 超 500 条被 schema 拦掉
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
    headers: { cookie },
    payload: { name, kind: 'chapter' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

async function createQuestion(bankId: number, stem: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/banks/${bankId}/questions`,
    headers: { cookie },
    payload: { bankId, type: 'single', stem, options: ['甲', '乙'], answer: '0' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return json<{ id: number }>(res).id;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bulk-'));
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
  cookie = await login('admin', 'admin123');
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题目批量操作', () => {
  it('批量改难度：记人工标注、只动本库题、跳过不存在的 id', async () => {
    const bankId = await createBank('批量难度测试库');
    const otherId = await createBank('另一个库');
    const q1 = await createQuestion(bankId, '批量难度题一');
    const q2 = await createQuestion(bankId, '批量难度题二');
    const qOther = await createQuestion(otherId, '别的库的题');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/bulk-difficulty`,
      headers: { cookie },
      payload: { ids: [q1, q2, qOther, 999999], difficulty: 'hard' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ updated: number; skipped: number }>(res)).toEqual({ updated: 2, skipped: 2 });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
    });
    const questions = json<{ questions: { difficulty: string; difficulty_source: string }[] }>(list).questions;
    expect(questions).toHaveLength(2);
    for (const q of questions) {
      expect(q.difficulty).toBe('hard');
      // 人工标注：之后「重算难度」不会覆盖
      expect(q.difficulty_source).toBe('manual');
    }

    const otherList = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${otherId}/questions`,
      headers: { cookie },
    });
    const otherQuestions = json<{ questions: { difficulty_source: string }[] }>(otherList).questions;
    expect(otherQuestions[0]?.difficulty_source).not.toBe('manual');
  });

  it('批量删除：只删本库题、题库题量同步、跨库 id 被跳过', async () => {
    const bankId = await createBank('批量删除测试库');
    const otherId = await createBank('保留库');
    const q1 = await createQuestion(bankId, '待删题一');
    const q2 = await createQuestion(bankId, '待删题二');
    const qKeep = await createQuestion(otherId, '必须保留的题');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/bulk-delete`,
      headers: { cookie },
      payload: { ids: [q1, q2, qKeep, 999999] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ deleted: number; skipped: number }>(res)).toEqual({ deleted: 2, skipped: 2 });

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
    });
    expect(json<{ total: number }>(after).total).toBe(0);

    const banks = await app.inject({ method: 'GET', url: '/api/v1/banks', headers: { cookie } });
    const rows = json<{ banks: { id: number; question_count: number }[] }>(banks).banks;
    expect(rows.find((b) => b.id === bankId)?.question_count).toBe(0);

    const keep = await app.inject({
      method: 'GET',
      url: `/api/v1/banks/${otherId}/questions`,
      headers: { cookie },
    });
    expect(json<{ total: number }>(keep).total).toBe(1);
  });

  it('空数组 / 超 500 条会被 schema 拦掉（不会误删）', async () => {
    const bankId = await createBank('参数校验库');
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/bulk-delete`,
      headers: { cookie },
      payload: { ids: [] },
    });
    expect(empty.statusCode).toBe(400);
    const tooMany = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/bulk-delete`,
      headers: { cookie },
      payload: { ids: Array.from({ length: 501 }, (_, i) => i + 1) },
    });
    expect(tooMany.statusCode).toBe(400);
  });
});
