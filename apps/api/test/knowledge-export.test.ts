import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { readDocxText } from '../src/utils/docx.js';

/**
 * 知识点讲义导出：整门课程（按「章节 → 课时」组织）与单个课时，支持 Markdown 与 Word。
 * 文本类导出正文、链接类导出链接、附件类导出文件名。
 */
describe('知识点讲义导出', () => {
  let app: FastifyInstance;
  let dataDir: string;
  let cookie = '';
  let studentCookie = '';
  let courseId = 0;
  let lessonId = 0;
  let emptyLessonId = 0;

  function json<T>(res: { json: () => unknown }): T {
    return res.json() as T;
  }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-knowledge-'));
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
    cookie = `microclass_sid=${login.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: `kn_${Date.now().toString(36)}`, password: 'pass1234' },
    });
    studentCookie = `microclass_sid=${reg.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;

    const course = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie },
      payload: { name: '讲义导出课程', published: true },
    });
    courseId = json<{ id: number }>(course).id;

    const createLesson = async (title: string, groupName: string): Promise<number> => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lessons',
        headers: { cookie },
        payload: {
          title,
          videoKind: 'url',
          videoPath: `https://example.com/${encodeURIComponent(title)}.mp4`,
          courseId,
          groupName,
        },
      });
      return json<{ id: number }>(res).id;
    };
    lessonId = await createLesson('第一节 环境搭建', '第一章 基础');
    emptyLessonId = await createLesson('第二节 空知识点', '第一章 基础');
    await createLesson('第三节 面向对象', '第二章 进阶');

    // 三种知识点：文本 / 链接 / 附件
    const items = [
      { title: 'JDK 安装要点', kind: 'text', content: '下载 LTS 版本，注意配置 JAVA_HOME。' },
      { title: '官方文档', kind: 'link', url: 'https://docs.oracle.com/javase/' },
      { title: '课堂讲义', kind: 'file', fileName: '第一章讲义.pdf' },
    ];
    for (const item of items) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lessonId}/knowledge`,
        headers: { cookie },
        payload: item,
      });
      expect(res.statusCode, `创建知识点失败：${res.body}`).toBe(200);
    }
    void emptyLessonId;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('课程级 Markdown：按章节 → 课时组织，含正文/链接/附件名', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge.md`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const body = res.body;
    expect(body).toContain('# 讲义导出课程 · 知识点讲义');
    expect(body).toContain('## 第一章 基础');
    expect(body).toContain('## 第二章 进阶');
    expect(body).toContain('### 第一节 环境搭建');
    expect(body).toContain('**JDK 安装要点**');
    expect(body).toContain('下载 LTS 版本');
    expect(body).toContain('https://docs.oracle.com/javase/');
    expect(body).toContain('第一章讲义.pdf');
    // 没有知识点的课时也要出现（并标注）
    expect(body).toContain('_（本课时暂无知识点）_');
  });

  it('课程级 Word：合法 docx，且文本可读回', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge.docx`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.rawPayload.subarray(0, 2).toString('utf8')).toBe('PK');
    const text = readDocxText(res.rawPayload);
    expect(text).toContain('第一章 基础');
    expect(text).toContain('第一节 环境搭建');
    expect(text).toContain('JDK 安装要点');
    expect(text).toContain('附件：第一章讲义.pdf');
    expect(text).toContain('链接：https://docs.oracle.com/javase/');
  });

  it('课时级导出只含该课时', async () => {
    const md = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/knowledge.md`,
      headers: { cookie },
    });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain('第一节 环境搭建');
    // 单课时不再套章节层级，知识点本身就是二级标题
    expect(md.body).not.toContain('## 第一章 基础');
    expect(md.body).toContain('## JDK 安装要点');

    const docx = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/knowledge.docx`,
      headers: { cookie },
    });
    expect(docx.statusCode).toBe(200);
    expect(readDocxText(docx.rawPayload)).toContain('JDK 安装要点');
    expect(readDocxText(docx.rawPayload)).not.toContain('第二章 进阶');
  });

  it('没有知识点的课程也能导出（给出说明而不是报错）', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/courses',
      headers: { cookie },
      payload: { name: '空课程', published: true },
    });
    const emptyCourseId = json<{ id: number }>(created).id;
    const md = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${emptyCourseId}/knowledge.md`,
      headers: { cookie },
    });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain('0 条知识点');
    const docx = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${emptyCourseId}/knowledge.docx`,
      headers: { cookie },
    });
    expect(readDocxText(docx.rawPayload)).toContain('还没有任何知识点');
  });

  it('不存在的课程 / 课时返回 404', async () => {
    const course = await app.inject({
      method: 'GET',
      url: '/api/v1/courses/999999/knowledge.md',
      headers: { cookie },
    });
    expect(course.statusCode).toBe(404);
    const lesson = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons/999999/knowledge.docx',
      headers: { cookie },
    });
    expect(lesson.statusCode).toBe(404);
  });

  it('学生不能导出（越权矩阵）', async () => {
    const course = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${courseId}/knowledge.md`,
      headers: { cookie: studentCookie },
    });
    expect(course.statusCode).toBe(403);
    const lesson = await app.inject({
      method: 'GET',
      url: `/api/v1/lessons/${lessonId}/knowledge.docx`,
      headers: { cookie: studentCookie },
    });
    expect(lesson.statusCode).toBe(403);
  });
});
