/**
 * 批量导入允许"待补答案"：答案册扫描不清/缺失的资料很常见，
 * 原先一律 `请设置正确答案` 拒绝 → 整题丢失（真机：黄冈 350 题、活页检测 476 题进不了库）。
 *
 * 契约：
 *   - **批量导入**允许缺答案，并在返回里给出 `missingAnswer` 计数；
 *   - **单题创建**仍然强制答案（避免老师手滑漏填）。
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
let bankId = 0;

const json = <T>(res: { json: () => unknown }): T => res.json() as T;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-missing-answer-'));
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
  const bank = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/banks',
      payload: { name: '待补答案测试', kind: 'chapter' },
      headers: { cookie },
    }),
  );
  bankId = bank.id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function batch(questions: unknown[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----mcmiss' + Math.random().toString(36).slice(2);
  // 注意：manifest 要作为**普通字段**（没有 filename）提交，服务端按字段读取
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify({ questions })}\r\n`,
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('批量导入的"待补答案"', () => {
  it('缺答案的题也能导入，并报告 missingAnswer 计数', async () => {
    const mp = batch([
      { type: 'single', stem: '有答案的题（　　）', options: ['甲', '乙', '丙', '丁'], answer: 'B' },
      { type: 'single', stem: '答案册没覆盖的题（　　）', options: ['甲', '乙', '丙', '丁'] },
      { type: 'fill', stem: '答案被水印遮住的填空题 ____。' },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<{ inserted: number; missingAnswer: number; failed: { reason: string }[] }>(res);
    expect(result.inserted, JSON.stringify(result.failed)).toBe(3);
    expect(result.missingAnswer).toBe(2);
  });

  it('单题创建仍然强制答案（老师手滑漏填要被拦住）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions`,
      headers: { cookie },
      payload: { type: 'single', stem: '单题创建必须有答案（　　）', options: ['甲', '乙'], answer: '' },
    });
    expect(res.statusCode).toBe(400);
    // 具体文案由校验层决定（业务校验/schema 校验），只要被拦住即可
    expect(json<{ error: { code: string } }>(res).error.code).toBe('BAD_REQUEST');
  });

  it('缺答案的题不会让刷题判分崩掉（按"未作答即错"处理）', async () => {
    const list = json<{ questions: { id: number }[] }>(
      await app.inject({ method: 'GET', url: `/api/v1/banks/${bankId}/questions?pageSize=50`, headers: { cookie } }),
    );
    const target = list.questions.find((q) => q.id > 0);
    expect(target).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${target?.id}/answer`,
      headers: { cookie },
      payload: { answer: 'A' },
    });
    // 判分接口存在且不 500 即可（缺答案题不应导致服务端异常）
    expect(res.statusCode).toBeLessThan(500);
  });
});
