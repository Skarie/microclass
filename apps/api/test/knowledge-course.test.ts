/**
 * 课程级知识点：CRUD、权限、课程详情 / 课时详情里的读取。
 * 课程级知识点整门课共享（lesson_id 为空），与原有课时级 CRUD 语义并存。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface KnowledgeDto {
  id: number;
  lesson_id: number | null;
  course_id: number | null;
  title: string;
  kind: string;
  content: string;
  url: string;
  sort: number;
}

describe('课程级知识点', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let admin = '';
  let student = '';
  let courseId = 0;
  let lessonId = 0;
  let orphanLessonId = 0;

  const json = <T>(res: { json: () => unknown }): T => res.json() as T;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-course-kn-'));
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
      payload: { username: `ck_${Date.now().toString(36)}`, password: 'pass1234' },
    });
    student = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

    const course = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie: admin },
      payload: { name: '课程知识点课程', published: true },
    });
    courseId = json<{ id: number }>(course).id;

    const createLesson = async (title: string, cid: number | null): Promise<number> => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lessons',
        headers: { cookie: admin },
        payload: {
          title,
          videoKind: 'url',
          videoPath: `https://example.com/${encodeURIComponent(title)}.mp4`,
          ...(cid === null ? {} : { courseId: cid }),
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      return json<{ id: number }>(res).id;
    };
    lessonId = await createLesson('课时一', courseId);
    orphanLessonId = await createLesson('未归类课时', null);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let firstId = 0;

  it('新建文本 / 链接知识点（201），列表按 sort,id 返回', async () => {
    const text = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: '课程总览', kind: 'text', content: '整门课的知识地图。' },
    });
    expect(text.statusCode, text.body).toBe(201);
    firstId = json<{ id: number }>(text).id;

    const link = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: '官方文档', kind: 'link', url: 'https://example.com/docs' },
    });
    expect(link.statusCode, link.body).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: student },
    });
    expect(list.statusCode, list.body).toBe(200);
    const knowledge = json<{ knowledge: KnowledgeDto[] }>(list).knowledge;
    expect(knowledge.map((k) => k.title)).toEqual(['课程总览', '官方文档']);
    expect(knowledge[0]).toMatchObject({ lesson_id: null, course_id: courseId, kind: 'text' });
    expect(knowledge[1]).toMatchObject({ kind: 'link', url: 'https://example.com/docs' });
  });

  it('kind=file 的课程级附件返回 400 并说明原因', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: '课件', kind: 'file', fileName: 'a.pdf' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('不支持上传附件');
  });

  it('参数校验：空标题 / 非法链接 / 课程不存在', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: '   ', kind: 'text' },
    });
    expect(empty.statusCode).toBe(400);
    const badLink = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: 'x', kind: 'link', url: 'ftp://x' },
    });
    expect(badLink.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/courses/99999/knowledge',
      headers: { cookie: admin },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('权限：学生不能写、未登录读写都 401', async () => {
    const asStudent = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: student },
      payload: { title: 'x', kind: 'text' },
    });
    expect(asStudent.statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/courses/${courseId}/knowledge` });
    expect(anonymous.statusCode).toBe(401);
    const anonymousWrite = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      payload: { title: 'x', kind: 'text' },
    });
    expect(anonymousWrite.statusCode).toBe(401);
  });

  it('课程详情返回 knowledge；课时详情返回 courseKnowledge', async () => {
    const course = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}`,
      headers: { cookie: student },
    });
    expect(course.statusCode, course.body).toBe(200);
    expect(json<{ knowledge: KnowledgeDto[] }>(course).knowledge.length).toBe(2);

    const lesson = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}`,
      headers: { cookie: student },
    });
    expect(lesson.statusCode, lesson.body).toBe(200);
    expect(json<{ courseKnowledge: KnowledgeDto[] }>(lesson).courseKnowledge.length).toBe(2);

    const orphan = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${orphanLessonId}`,
      headers: { cookie: student },
    });
    expect(json<{ courseKnowledge: KnowledgeDto[] }>(orphan).courseKnowledge).toEqual([]);
  });

  it('PUT / DELETE 同时支持课程级知识点', async () => {
    const update = await app.inject({
      method: 'PUT',
      url: `/api/v1/knowledge/${firstId}`,
      headers: { cookie: admin },
      payload: { title: '课程总览（修订）', content: '新正文' },
    });
    expect(update.statusCode, update.body).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
    });
    expect(json<{ knowledge: KnowledgeDto[] }>(list).knowledge[0]).toMatchObject({
      title: '课程总览（修订）',
      content: '新正文',
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/knowledge/${firstId}`,
      headers: { cookie: admin },
    });
    expect(del.statusCode, del.body).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
    });
    expect(json<{ knowledge: KnowledgeDto[] }>(after).knowledge.map((k) => k.title)).toEqual(['官方文档']);

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/v1/knowledge/99999',
      headers: { cookie: admin },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('课程级知识点进入课程讲义导出', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${courseId}/knowledge`,
      headers: { cookie: admin },
      payload: { title: '共享要点', kind: 'text', content: '共享正文' },
    });
    const md = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge.md`,
      headers: { cookie: admin },
    });
    expect(md.statusCode, md.body).toBe(200);
    expect(md.body).toContain('## 课程共享知识点');
    expect(md.body).toContain('共享正文');
  });
});
