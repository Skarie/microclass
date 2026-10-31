/**
 * 知识点批量导入接口：dryRun 预览、正式导入（zip / 多个 md）、图片落盘与重写、
 * 未匹配报告、重复导入跳过、knowledge-media 只读路由。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { buildZip } from './helpers/zipBuilder.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

interface KnowledgeDto {
  id: number;
  lesson_id: number | null;
  course_id: number | null;
  title: string;
  kind: string;
  content: string;
}

interface ImportReport {
  dryRun: boolean;
  matched: number;
  unmatched: number;
  skipped: number;
  missingImages: number;
  imported?: number;
  items: {
    lessonId: number;
    lessonTitle: string;
    chapter: string;
    title: string;
    chars: number;
    images: number;
  }[];
  unmatchedItems: { title: string; chapter: string; reason: string }[];
}

function multipart(files: { name: string; data: Buffer }[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----mckn' + Math.random().toString(36).slice(2);
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('知识点批量导入', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let admin = '';
  let student = '';
  let courseA = 0;
  let courseB = 0;
  let lessonA1 = 0;
  let lessonA2 = 0;
  let lessonB1 = 0;
  let lessonB2 = 0;
  let lessonB3 = 0;

  const json = <T>(res: { json: () => unknown }): T => res.json() as T;
  const mediaDir = (): string => path.join(dataDir, 'knowledge-media');

  const createLesson = async (courseId: number, title: string, groupName: string): Promise<number> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lessons',
      headers: { cookie: admin },
      payload: {
        title,
        videoKind: 'url',
        videoPath: `https://example.com/${encodeURIComponent(title)}.mp4`,
        courseId,
        groupName,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return json<{ id: number }>(res).id;
  };

  const importZip = async (courseId: number, data: Buffer, query = ''): Promise<ImportReport> => {
    const mp = multipart([{ name: 'materials.zip', data }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge/import${query}`,
      headers: { ...mp.headers, cookie: admin },
      payload: mp.body,
    });
    expect(res.statusCode, res.body).toBe(200);
    return json<ImportReport>(res);
  };

  const detail = async (lessonId: number): Promise<KnowledgeDto[]> => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}`,
      headers: { cookie: student },
    });
    expect(res.statusCode, res.body).toBe(200);
    return json<{ knowledge: KnowledgeDto[] }>(res).knowledge;
  };

  const zip = buildZip([
    {
      name: '第一章 有理数/1.1 正数和负数的概念.md',
      data: '# 1.1 正数和负数的概念\n\n正数大于零。\n\n![](images/num.png)\n\n![](./images/missing.png)\n',
    },
    { name: '第一章 有理数/images/num.png', data: PNG },
    { name: '第一章 有理数/1.1 正数和负数的概念（补充）.md', data: '补充内容' },
    {
      name: '第二章 整式/2.1 一元一次方程.md',
      data: '# 2.1 一元一次方程\n\n![](images/eq.png)\n',
    },
    { name: '第二章 整式/images/eq.png', data: PNG },
    { name: '第二章 整式/2.3 未匹配标题.md', data: '# 未匹配标题' },
    { name: '__MACOSX/第一章 有理数/._1.1 正数和负数的概念.md', data: 'junk' },
  ]);

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kn-import-'));
    const config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_LOG_LEVEL: 'silent',
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
    });
    const built = await buildApp(config, { db: new Db(':memory:') });
    app = built.app;
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    admin = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: `imp_${Date.now().toString(36)}`, password: 'pass1234' },
    });
    student = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

    const createCourse = async (name: string): Promise<number> => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/courses',
        headers: { cookie: admin },
        payload: { name, published: true },
      });
      return json<{ id: number }>(res).id;
    };
    courseA = await createCourse('导入课程 A');
    courseB = await createCourse('导入课程 B');
    lessonA1 = await createLesson(courseA, '正数和负数的概念', '第一章 有理数');
    lessonA2 = await createLesson(courseA, '一元一次方程', '第二章 整式');
    lessonB1 = await createLesson(courseB, '有理数的运算', '第一章 有理数');
    lessonB2 = await createLesson(courseB, '一元一次方程', '第二章 整式');
    lessonB3 = await createLesson(courseB, '整式的加减', '第二章 整式');
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('dryRun：解析 + 预览，不写库、不落图片', async () => {
    const report = await importZip(courseA, zip, '?dryRun=1');
    expect(report).toMatchObject({
      dryRun: true,
      matched: 3,
      unmatched: 1,
      skipped: 1,
      missingImages: 1,
    });
    expect(report.imported).toBeUndefined();
    expect(report.items).toHaveLength(2);
    expect(report.items[0]).toMatchObject({
      lessonId: lessonA1,
      lessonTitle: '正数和负数的概念',
      chapter: '第一章 有理数',
      title: '1.1 正数和负数的概念',
      images: 1,
    });
    expect(report.items[0]?.chars).toBeGreaterThan(0);
    expect(report.unmatchedItems).toEqual([{ title: '2.3 未匹配标题', chapter: '第二章 整式', reason: 'no-lesson' }]);
    expect(await detail(lessonA1)).toEqual([]);
    expect(fs.readdirSync(mediaDir())).toEqual([]);
  });

  it('正式导入：知识点写入、图片落盘并重写 URL', async () => {
    const report = await importZip(courseA, zip);
    expect(report).toMatchObject({
      dryRun: false,
      matched: 3,
      unmatched: 1,
      skipped: 1,
      imported: 2,
      missingImages: 1,
    });

    const knowledge = await detail(lessonA1);
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({
      lesson_id: lessonA1,
      course_id: null,
      title: '正数和负数的概念',
      kind: 'text',
    });
    expect(knowledge[0]?.content).toContain('/api/v1/knowledge-media/');
    expect(knowledge[0]?.content).not.toContain('(images/num.png)');
    // 缺失图片保留原路径
    expect(knowledge[0]?.content).toContain('./images/missing.png');

    const files = fs.readdirSync(mediaDir());
    expect(files.some((f) => /^[0-9a-f]{12}-num\.png$/.test(f))).toBe(true);
    const url = /!\[[^\]]*\]\((\/api\/v1\/knowledge-media\/[^)]+)\)/.exec(knowledge[0]?.content ?? '')?.[1] ?? '';
    expect(url).not.toBe('');

    const image = await app.inject({ method: 'GET', url, headers: { cookie: student } });
    expect(image.statusCode, image.body).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['cache-control']).toBe('private, max-age=86400');
    expect(Buffer.from(image.rawPayload).equals(PNG)).toBe(true);

    const knowledge2 = await detail(lessonA2);
    expect(knowledge2[0]?.content).toContain('/api/v1/knowledge-media/');
    expect(fs.readdirSync(mediaDir()).some((f) => f.endsWith('-eq.png'))).toBe(true);
  });

  it('重复导入：同名 text 知识点全部跳过，不再产生新数据', async () => {
    const report = await importZip(courseA, zip);
    expect(report).toMatchObject({ matched: 3, skipped: 3, imported: 0 });
    expect(report.items).toEqual([]);
    expect(await detail(lessonA1)).toHaveLength(1);
  });

  it('多个平铺 md：文件名匹配优先，其次 H1 标题', async () => {
    const mp = multipart([
      { name: 'notes.md', data: Buffer.from('# 1.2 有理数的运算\n\n![](images/x.png)\n') },
      { name: '2.2 一元一次方程.md', data: Buffer.from('# 任意标题\n\n正文') },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseB}/knowledge/import`,
      headers: { ...mp.headers, cookie: admin },
      payload: mp.body,
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = json<ImportReport>(res);
    expect(report.matched).toBe(2);
    expect(report.imported).toBe(2);
    expect(report.missingImages).toBe(1);
    expect(report.items.map((i) => i.lessonId).sort()).toEqual([lessonB1, lessonB2].sort());
    expect((await detail(lessonB1))[0]?.content).toContain('1.2 有理数的运算');
    expect((await detail(lessonB2))[0]?.content).toContain('正文');
  });

  it('单个 .md 也能用文件名直接匹配课时', async () => {
    const mp = multipart([{ name: '1.4 整式的加减.md', data: Buffer.from('补充正文') }]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseB}/knowledge/import?dryRun=true`,
      headers: { ...mp.headers, cookie: admin },
      payload: mp.body,
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = json<ImportReport>(res);
    expect(report.dryRun).toBe(true);
    expect(report.matched).toBe(1);
    expect(report.items[0]?.lessonId).toBe(lessonB3);
  });

  it('不支持的文件类型 / 学生越权 / 课程不存在', async () => {
    const bad = multipart([{ name: 'a.docx', data: Buffer.from('x') }]);
    const badRes = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseA}/knowledge/import`,
      headers: { ...bad.headers, cookie: admin },
      payload: bad.body,
    });
    expect(badRes.statusCode).toBe(400);

    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseA}/knowledge/import`,
      headers: { ...bad.headers, cookie: student },
      payload: bad.body,
    });
    expect(denied.statusCode).toBe(403);

    const good = multipart([{ name: '1.1 x.md', data: Buffer.from('x') }]);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/courses/99999/knowledge/import',
      headers: { ...good.headers, cookie: admin },
      payload: good.body,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('knowledge-media：未登录 401、非法名 400、不存在 404', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/knowledge-media/abc-1.png' });
    expect(anonymous.statusCode).toBe(401);

    const illegal = await app.inject({
      method: 'GET',
      url: '/api/v1/knowledge-media/.hidden.png',
      headers: { cookie: student },
    });
    expect(illegal.statusCode).toBe(400);

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/v1/knowledge-media/..%2F..%2Fsecret.png',
      headers: { cookie: student },
    });
    expect([400, 404]).toContain(traversal.statusCode);

    const gone = await app.inject({
      method: 'GET',
      url: '/api/v1/knowledge-media/0123456789ab-not-there.png',
      headers: { cookie: student },
    });
    expect(gone.statusCode).toBe(404);
  });
});
