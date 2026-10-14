/**
 * 题图上传（`POST /question-media`）：内容寻址 + 去重。
 *
 * 为什么需要它：数学资料把公式/图形做成了图片，要还原题目必须把图**按原位内联**进题干
 * （`![](/api/v1/question-media/<sha>.png)`）。平台原先只有读取（GET），没有上传入口。
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

const json = <T>(res: { json: () => unknown }): T => res.json() as T;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(field: string, name: string, data: Buffer): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----mcmedia' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-media-'));
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
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('题图上传（题干内联图）', () => {
  it('上传后返回可直接写进题干的 URL，且能取回同一张图', async () => {
    const mp = multipart('file', 'formula.png', PNG);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/question-media',
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{ url: string; file: string; deduped: boolean }>(res);
    expect(body.url).toMatch(/^\/api\/v1\/question-media\/[0-9a-f]{40}\.png$/);

    const got = await app.inject({ method: 'GET', url: body.url, headers: { cookie } });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.length).toBe(PNG.length);
  });

  it('同一张图重复上传会去重（内容寻址）', async () => {
    // 注意：multipart 的 body 与 headers 必须来自**同一次**调用（boundary 要一致）
    const a = multipart('file', 'a.png', PNG);
    const b = multipart('file', 'b.png', PNG);
    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/v1/question-media',
      payload: a.body,
      headers: { ...a.headers, cookie },
    });
    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/v1/question-media',
      payload: b.body,
      headers: { ...b.headers, cookie },
    });
    expect(firstRes.statusCode, firstRes.body).toBe(200);
    expect(secondRes.statusCode, secondRes.body).toBe(200);
    const first = json<{ url: string; deduped: boolean }>(firstRes);
    const second = json<{ url: string; deduped: boolean }>(secondRes);
    expect(second.url).toBe(first.url);
    expect(second.deduped).toBe(true);
  });

  it('非图片内容被拒绝（不能往题图仓库塞任意文件）', async () => {
    const mp = multipart('file', 'evil.txt', Buffer.from('not an image'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/question-media',
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
