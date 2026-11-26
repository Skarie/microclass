import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { assertIntegerIdParams, parseIntegerId } from '../src/http/idParams.js';

/**
 * 路径参数 `:id` 的整数校验（2.4.3）。
 *
 * 事故：2.4.2 + PG 下 `/api/v1/questions/abc`、`/banks/abc`、`/exams/abc` 返回 **500**
 * （`invalid input syntax for type bigint`）—— 客户端拼错 id 被当成服务器错误。
 * 修复：`http/idParams.ts` 的全局 `preValidation` 守卫，非正整数一律 400，
 * 不把非法值交给 SQL；合法数字 id 的 200/404 语义保持不变。
 *
 * 覆盖：三个主接口 + 嵌套 `:id` 路由 + 合法 id（200/404）+ 未登录 401（鉴权先于参数校验）。
 * PG 分支见 `pg-http-id.test.ts`（需 `MC_PG_TEST_URL`）。
 */
let app: FastifyInstance;
let dataDir: string;
let adminCookie = '';
let questionId = 0;
let bankId = 0;

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

/** 断言「非法 id」的响应：400 + 项目统一错误信封（不是 Fastify 原生 500） */
function expectBadRequest(res: { statusCode: number; json: () => unknown }): void {
  expect(res.statusCode).toBe(400);
  const body = json<ErrorBody>(res);
  expect(body.error.code).toBe('BAD_REQUEST');
  expect(body.error.message).toContain('必须是正整数');
  expect(body.error.requestId).toBeTruthy();
}

async function get(url: string, cookie = adminCookie): Promise<{ statusCode: number; json: () => unknown }> {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-idparams-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
  });
  const built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();

  // 登录拿管理员会话（除 401 用例外，所有请求都带 cookie）
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  expect(login.statusCode).toBe(200);
  adminCookie = cookieOf(login);

  bankId = await built.deps.banks.create({ name: 'ID 校验题库', kind: 'chapter', subject: '数学', book: '测试册' });
  questionId = await built.deps.questions.create({
    bankId,
    type: 'single',
    stem: '1+1=?',
    options: ['A. 1', 'B. 2'],
    answer: 'B',
    point: '加法',
    difficulty: 'easy',
  });
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('非数字 id → 400（PG 下原本是 bigint 500）', () => {
  it('GET /questions/abc → 400', async () => {
    expectBadRequest(await get('/api/v1/questions/abc'));
  });

  it('GET /banks/abc → 400', async () => {
    expectBadRequest(await get('/api/v1/banks/abc'));
  });

  it('GET /exams/abc → 400', async () => {
    expectBadRequest(await get('/api/v1/exams/abc'));
  });

  it('嵌套 :id 路由同样 400（/banks/:id/questions、/questions/:id/tags、/exams/:id/paper）', async () => {
    expectBadRequest(await get('/api/v1/banks/abc/questions'));
    expectBadRequest(await get('/api/v1/questions/abc/tags'));
    expectBadRequest(await get('/api/v1/exams/abc/paper'));
  });

  it('0 / 负数 / 小数 / 超长数字都算非法（400）', async () => {
    for (const bad of ['0', '-1', '1.5', '1e3', '99999999999999999999']) {
      expectBadRequest(await get(`/api/v1/questions/${encodeURIComponent(bad)}`));
    }
  });

  it('未登录访问 /questions/abc 仍是 401（鉴权先于参数校验）', async () => {
    const res = await get('/api/v1/questions/abc', '');
    expect(res.statusCode).toBe(401);
    expect(json<ErrorBody>(res).error.code).toBe('UNAUTHORIZED');
  });

  it('字符串 id 路由不受影响：/media-roots/:id 的 id 是 slug（m-abc）', async () => {
    const res = await get('/api/v1/media-roots/m-abc/browse');
    // 400 来自 handler 自己的「无效的媒体目录」，不是整数校验的「必须是正整数」
    expect(res.statusCode).toBe(400);
    expect(json<ErrorBody>(res).error.message).toBe('无效的媒体目录');
  });
});

describe('合法数字 id 语义不变', () => {
  it('存在的题目 / 题库返回 200', async () => {
    const q = await get(`/api/v1/questions/${questionId}`);
    expect(q.statusCode).toBe(200);
    expect(json<{ question: { id: number; stem: string } }>(q).question.stem).toBe('1+1=?');

    const b = await get(`/api/v1/banks/${bankId}`);
    expect(b.statusCode).toBe(200);
    expect(json<{ bank?: { id: number }; questions?: unknown[] }>(b)).toBeTruthy();
  });

  it('不存在的数字 id 仍是 404（不是 400）', async () => {
    for (const url of ['/api/v1/questions/999999', '/api/v1/banks/999999', '/api/v1/exams/999999']) {
      const res = await get(url);
      expect(res.statusCode).toBe(404);
      expect(json<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    }
  });
});

describe('helper 边界（不经过 HTTP 也能复用）', () => {
  it('parseIntegerId 只接受正的安全整数', () => {
    expect(parseIntegerId('7', 'id')).toBe(7);
    expect(parseIntegerId('0007', 'id')).toBe(7);
    for (const bad of ['', 'abc', '0', '-1', '1.5', '1e3', ' 7', '7 ', '99999999999999999999']) {
      expect(() => parseIntegerId(bad, 'id')).toThrow(AppError);
    }
  });

  it('assertIntegerIdParams 只看 id/qid/questionId，放过 :hash / :file', () => {
    expect(() => assertIntegerIdParams({ hash: 'abc123', file: 'a-b.css' })).not.toThrow();
    expect(() => assertIntegerIdParams({ id: '12', qid: '3', questionId: '4' })).not.toThrow();
    expect(() => assertIntegerIdParams({ qid: 'x' })).toThrow(AppError);
    expect(() => assertIntegerIdParams(undefined)).not.toThrow();
  });
});
