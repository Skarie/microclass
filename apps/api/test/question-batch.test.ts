/**
 * 批量导入（资料提炼结果）测试。
 *
 * 要挡住的问题：
 *   - 一题坏掉就整批失败（老师导 30 题，第 7 题格式不对，前 6 题也白导了）；
 *   - 带图的题当成纯文字题建 → 图片丢掉；
 *   - manifest 里字段是对象/数组时被 String() 成 '[object Object]'（外部数据必须防）；
 *   - 不校验上限，一次塞几万题把服务打挂。
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
let bankId = 0;

const json = <T>(res: { json: () => unknown }): T => res.json() as T;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** 组装 multipart：manifest 字符串 + 可选图片文件 */
function batch(
  manifest: unknown,
  files: { field: string; name: string; data: Buffer }[] = [],
): {
  body: Buffer;
  headers: Record<string, string>;
} {
  const boundary = '----mcbatch' + Math.random().toString(36).slice(2);
  const chunks: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n`,
    ),
  ];
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: image/png\r\n\r\n`,
      ),
    );
    chunks.push(f.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const countIn = (): number =>
  Number((db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bankId]) as { c: number }).c);

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-batch-'));
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
    payload: { name: '批量导入课程', published: true },
    headers: { cookie },
  });
  const bank = await app.inject({
    method: 'POST',
    url: '/api/v1/banks',
    payload: { name: '批量导入题库', courseId: json<{ id: number }>(course).id },
    headers: { cookie },
  });
  bankId = json<{ id: number }>(bank).id;
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('批量导入（含图片）', () => {
  it('一次导入多题：文字题 + 图片题都进去，逐题带章节知识点', async () => {
    const before = countIn();
    const mp = batch(
      {
        questions: [
          {
            type: 'single',
            stem: '24 + 38 = ?',
            options: ['52', '62', '72'],
            answer: 'B',
            analysis: '24+38=62',
            chapter: '第一章 加与减',
            point: '两位数加法',
            difficulty: 'easy',
          },
          { type: 'judge', stem: '7 是质数。', answer: '对', chapter: '第二章 数的认识', point: '质数与合数' },
          { type: 'short', stem: '写出一句含"春风"的句子。', answer: '略', chapter: '语文一单元', point: '句子练习' },
          // 图片题：题面是图（扫描件场景），题干留空
          { type: 'fill', stem: '', answer: '42', image: 'img0', chapter: '第一章 加与减', point: '乘法' },
        ],
      },
      [{ field: 'img0', name: 'scan.png', data: PNG }],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<{ inserted: number; failed: { index: number; reason: string }[] }>(res);
    expect(result.inserted).toBe(4);
    expect(result.failed).toEqual([]);
    expect(countIn()).toBe(before + 4);

    // 图片题：题干空、有图、has_image 置位
    const img = db.get<{ stem: string; image_path: string; has_image: number }>(
      'SELECT stem, image_path, has_image FROM questions WHERE bank_id = ? AND type = ? AND stem = ?',
      [bankId, 'fill', ''],
    ) as { stem: string; image_path: string; has_image: number };
    expect(img.image_path).not.toBe('');
    expect(Number(img.has_image)).toBe(1);

    // 元数据落库
    const meta = db.get<{ chapter: string; point: string }>(
      'SELECT chapter, point FROM questions WHERE bank_id = ? AND stem LIKE ?',
      [bankId, '24 + 38%'],
    ) as { chapter: string; point: string };
    expect(meta.chapter).toBe('第一章 加与减');
    expect(meta.point).toBe('两位数加法');
  });

  it('单题出错不影响其它题，并逐题报原因', async () => {
    const before = countIn();
    const mp = batch({
      questions: [
        { type: 'judge', stem: '正常的一题。', answer: '对' },
        // 选择题缺选项 → 该题失败
        { type: 'single', stem: '缺选项的题。', answer: 'A' },
        { type: 'judge', stem: '后面这题也要成功。', answer: '错' },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    const result = json<{ inserted: number; failed: { index: number; reason: string }[] }>(res);
    expect(result.inserted).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.index).toBe(1);
    expect(result.failed[0]?.reason).toContain('选项');
    expect(countIn()).toBe(before + 2);
  });

  it('manifest 字段是对象/数组时不会被写成 [object Object]', async () => {
    const mp = batch({
      questions: [{ type: 'judge', stem: { 恶意: '对象' }, answer: ['A', 'B'], chapter: { a: 1 } }],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    // 题干拿不到字符串 → 该题失败（而不是存进 '[object Object]'）
    const result = json<{ inserted: number; failed: { reason: string }[] }>(res);
    expect(result.inserted).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toContain('题干');
  });

  it('题干里的 [[img:N]] 占位符会被替换成题图 URL（一份资料一个请求的关键）', async () => {
    const mp = batch(
      {
        questions: [
          // 数学卷的典型形态：公式/图形是图片，文本里留占位符
          { type: 'short', stem: '如图，一次函数 [[img:0]] 的图象经过点 [[img:1]]。', answer: 'x=2', chapter: '测试' },
          { type: 'fill', stem: '化简 [[img:2]] = ____', answer: '1' },
        ],
      },
      [
        { field: 'media0', name: 'm0.png', data: PNG },
        { field: 'media1', name: 'm1.png', data: PNG },
        { field: 'media2', name: 'm2.png', data: PNG },
      ],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: mp.body,
      headers: { ...mp.headers, cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = json<{ inserted: number; failed: { reason: string }[] }>(res);
    expect(result.inserted).toBe(2);
    expect(result.failed).toEqual([]);

    const row = db.get<{ stem: string }>('SELECT stem FROM questions WHERE bank_id = ? AND stem LIKE ?', [
      bankId,
      '%一次函数%',
    ]) as { stem: string };
    // 占位符必须变成 markdown 图片，而不是留着 [[img:0]] 或空白
    expect(row.stem).toContain('![](/api/v1/question-media/');
    expect(row.stem).not.toContain('[[img:');
    const url = /!\[\]\(\/api\/v1\/question-media\/[0-9a-f]{40}\.png\)/.exec(row.stem);
    expect(url, '应生成合法的题图 URL').not.toBeNull();
  });

  it('manifest 缺失 / 非 JSON / 空数组 / 超上限都要 400', async () => {
    const cases: { body: Buffer; headers: Record<string, string>; tip: string }[] = [
      { ...batch({ questions: [] }), tip: '非空数组' },
      {
        ...batch({ questions: Array.from({ length: 501 }, () => ({ type: 'judge', stem: 'x', answer: '对' })) }),
        tip: '最多',
      },
    ];
    for (const c of cases) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/banks/${bankId}/questions/batch`,
        payload: c.body,
        headers: { ...c.headers, cookie },
      });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.body).toContain(c.tip);
    }
    // 非 JSON 的 manifest
    const boundary = '----mcBad';
    const bad = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\nnot-json\r\n--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/banks/${bankId}/questions/batch`,
      payload: bad,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('JSON');
  });
});
