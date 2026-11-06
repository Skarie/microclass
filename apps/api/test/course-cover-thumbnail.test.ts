import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { fileEtag } from '../src/services/coverThumbnailService.js';

/**
 * 课程封面缩略图（`GET /course-cover/:id?w=`）的接口级用例。
 *
 * ffmpeg 指向一个不存在的可执行文件：生成必然失败 → 用来验证「回退原图不 500」；
 * 成功路径则预先在 `<dataDir>/cover-cache/<id>-<w>.webp` 放好缓存文件，走命中分支。
 */
let app: FastifyInstance;
let dataDir: string;
let cacheDir: string;
let adminCookie = '';
let courseId = 0;
let bareCourseId = 0;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f6d0000000049454e44ae426082',
  'hex',
);
const WEBP = Buffer.from('52494646240000005745425056503820180000003001009d012a0100010000000000', 'hex');

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

function cookieOf(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

function multipart(fields: { name: string; filename: string; contentType: string; data: Buffer }[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----mc-cover-boundary';
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function seedThumbnail(id: number, width: number, bytes: Buffer): string {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${id}-${width}.webp`);
  fs.writeFileSync(file, bytes);
  return file;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cover-api-'));
  cacheDir = path.join(dataDir, 'cover-cache');
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
    MC_LOG_LEVEL: 'silent',
    MC_FFMPEG_PATH: path.join(dataDir, 'missing-ffmpeg'),
  });
  const built = await buildApp(config, { db: new Db(':memory:') });
  app = built.app;
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin123' },
  });
  adminCookie = cookieOf(login);

  courseId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '有封面的课程', published: true },
    }),
  ).id;
  bareCourseId = json<{ id: number }>(
    await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: adminCookie },
      payload: { name: '没有封面的课程', published: true },
    }),
  ).id;

  const mp = multipart([{ name: 'file', filename: 'cover.png', contentType: 'image/png', data: PNG }]);
  const upload = await app.inject({
    method: 'POST',
    url: `/api/v1/courses/${courseId}/cover`,
    headers: { cookie: adminCookie, 'content-type': mp.contentType },
    payload: mp.body,
  });
  expect(upload.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/v1/course-cover/:id（缩略图）', () => {
  it('缓存命中时直接返回 webp，并带 Cache-Control 与 ETag', async () => {
    const file = seedThumbnail(courseId, 276, WEBP);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/course-cover/${courseId}?w=276`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toBe('private, max-age=604800');
    expect(res.headers.etag).toBe(fileEtag(file));
    expect(Buffer.from(res.rawPayload).equals(WEBP)).toBe(true);
  });

  it('第二次请求仍走缓存（内容不变，不会重新生成）', async () => {
    const file = seedThumbnail(courseId, 300, WEBP);
    const url = `/api/v1/course-cover/${courseId}?w=300`;
    const first = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
    const mtime = fs.statSync(file).mtimeMs;
    const second = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    expect(Buffer.from(second.rawPayload).equals(WEBP)).toBe(true);
  });

  it('If-None-Match 命中 ETag 时返回 304', async () => {
    const file = seedThumbnail(courseId, 640, WEBP);
    const etag = fileEtag(file);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/course-cover/${courseId}?w=640`,
      headers: { cookie: adminCookie, 'if-none-match': etag ?? '' },
    });
    expect(res.statusCode).toBe(304);
    expect(Buffer.from(res.rawPayload).length).toBe(0);
  });

  it.each(['119', '1601', 'abc', '276.5', '', '-1'])('非法宽度 w=%s 返回 400', async (w) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/course-cover/${courseId}?w=${w}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('BAD_REQUEST');
  });

  it('ffmpeg 不可用时回退原图（200 + 原 MIME），不 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/course-cover/${courseId}?w=800`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.from(res.rawPayload).equals(PNG)).toBe(true);
    expect(fs.existsSync(path.join(cacheDir, `${courseId}-800.webp`))).toBe(false);
  });

  it('不带 w 时保持原图行为', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/course-cover/${courseId}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.rawPayload).equals(PNG)).toBe(true);
  });

  it('课程没有封面时 404（带不带 w 都一样）', async () => {
    for (const url of [`/api/v1/course-cover/${bareCourseId}`, `/api/v1/course-cover/${bareCourseId}?w=276`]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: adminCookie } });
      expect(res.statusCode).toBe(404);
    }
  });

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/course-cover/${courseId}?w=276` });
    expect(res.statusCode).toBe(401);
  });
});
