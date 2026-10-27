/**
 * GET /banks/catalog-sections：按册次（view=book）与按课程（view=course）的
 * book → section 分组、计数、kind 过滤与自然序（第一章在第二章前，'' 最后）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';

interface SectionCount {
  section: string;
  bankCount: number;
  questionCount: number;
}

interface SectionBook {
  book: string;
  isUnbound: boolean;
  bankCount: number;
  questionCount: number;
  sections: SectionCount[];
}

interface CourseBook {
  book: string;
  bankCount: number;
  questionCount: number;
  sections: SectionCount[];
}

interface SectionCourse {
  id: number;
  name: string;
  bankCount: number;
  questionCount: number;
  books: CourseBook[];
}

interface BookCatalog {
  view: 'book';
  books: SectionBook[];
}

interface CourseCatalog {
  view: 'course';
  courses: SectionCourse[];
}

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = '';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  return `microclass_sid=${res.cookies.find((c) => c.name === 'microclass_sid')?.value ?? ''}`;
}

async function getCatalog(query: string): Promise<BookCatalog | CourseCatalog> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/banks/catalog-sections${query}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return json<BookCatalog | CourseCatalog>(res);
}

/** 直接造数：这里只验证目录聚合，题量用 banks.question_count 预计算列 */
function seedBank(
  id: number,
  name: string,
  kind: string,
  book: string,
  section: string,
  courseId: number | null,
  questionCount: number,
): void {
  db.run(
    'INSERT INTO banks (id, name, kind, subject, book, section, course_id, question_count) VALUES (?,?,?,?,?,?,?,?)',
    [id, name, kind, '数学', book, section, courseId, questionCount],
  );
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-section-catalog-'));
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
  cookie = await login('admin', 'admin123');

  db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['数学']);
  db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['语文']);

  seedBank(1, '三上 · 第二章 分数', 'lesson', '三年级上册', '第二章 分数', 1, 2);
  seedBank(2, '三上 · 第一章 测量', 'lesson', '三年级上册', '第一章 测量', 1, 3);
  seedBank(3, '三上 · 未分章', 'lesson', '三年级上册', '', 1, 1);
  seedBank(4, '三上 · 总复习卷', 'chapter', '三年级上册', '第十章 总复习', 1, 4);
  seedBank(5, '未归类册次 · 集合', 'lesson', '', '第一章 集合', 1, 5);
  seedBank(6, '七上 · 有理数', 'lesson', '七年级上册', '第一章 有理数', 2, 2);
  seedBank(7, '九全 · 未分章', 'chapter', '九年级全一册', '', null, 6);
  seedBank(8, '整卷', 'paper', '', '', null, 7);
  seedBank(9, '必修1 · 集合', 'lesson', '必修1', '第一章 集合', 1, 8);
  seedBank(10, '必修10 · 函数', 'lesson', '必修10', '第二章 函数', 1, 9);
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('view=book：册次 → 章节分组', () => {
  it('册次按自然序、空册次排最后，计数与题量正确', async () => {
    const body = (await getCatalog('?view=book')) as BookCatalog;
    expect(body.view).toBe('book');
    expect(body.books.map((b) => b.book)).toEqual(['必修1', '三年级上册', '七年级上册', '九年级全一册', '必修10', '']);
    const grade3 = body.books.find((b) => b.book === '三年级上册');
    expect(grade3).toMatchObject({ isUnbound: false, bankCount: 4, questionCount: 10 });
    // 章节自然序：第一章 → 第二章 → 第十章 → 未分章（''）
    expect(grade3?.sections.map((s) => s.section)).toEqual(['第一章 测量', '第二章 分数', '第十章 总复习', '']);
    expect(grade3?.sections.map((s) => s.questionCount)).toEqual([3, 2, 4, 1]);
  });

  it('book 为空归到「未归类册次」，section 为空归到「未分章」', async () => {
    const body = (await getCatalog('?view=book')) as BookCatalog;
    const unboundBook = body.books[body.books.length - 1];
    expect(unboundBook).toMatchObject({ book: '', isUnbound: true, bankCount: 2, questionCount: 12 });
    expect(unboundBook?.sections.map((s) => s.section)).toEqual(['第一章 集合', '']);
    expect(unboundBook?.sections[0]).toMatchObject({ bankCount: 1, questionCount: 5 });
    expect(unboundBook?.sections[1]).toMatchObject({ bankCount: 1, questionCount: 7 });

    const grade9 = body.books.find((b) => b.book === '九年级全一册');
    expect(grade9).toMatchObject({ isUnbound: true, bankCount: 1, questionCount: 6 });
    expect(grade9?.sections).toEqual([{ section: '', bankCount: 1, questionCount: 6 }]);
  });

  it('kind 过滤只统计对应类型，非法 kind / view 报 400', async () => {
    const paper = (await getCatalog('?view=book&kind=paper')) as BookCatalog;
    expect(paper.books).toEqual([
      {
        book: '',
        isUnbound: true,
        bankCount: 1,
        questionCount: 7,
        sections: [{ section: '', bankCount: 1, questionCount: 7 }],
      },
    ]);

    const lesson = (await getCatalog('?kind=lesson')) as BookCatalog;
    expect(lesson.books.map((b) => b.book)).toEqual(['必修1', '三年级上册', '七年级上册', '必修10', '']);
    const emptyBook = lesson.books[lesson.books.length - 1];
    expect(emptyBook).toMatchObject({ isUnbound: false, bankCount: 1, questionCount: 5 });

    const badKind = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/catalog-sections?kind=exam',
      headers: { cookie },
    });
    expect(badKind.statusCode).toBe(400);

    const badView = await app.inject({
      method: 'GET',
      url: '/api/v1/banks/catalog-sections?view=lesson',
      headers: { cookie },
    });
    expect(badView.statusCode).toBe(400);
  });
});

describe('view=course：课程下的册次 → 章节', () => {
  it('只统计 course_id 非空的题库，计数与分组正确', async () => {
    const body = (await getCatalog('?view=course')) as CourseCatalog;
    expect(body.view).toBe('course');
    expect(body.courses.map((c) => c.name).sort()).toEqual(['数学', '语文']);

    const math = body.courses.find((c) => c.name === '数学');
    expect(math).toMatchObject({ id: 1, bankCount: 7, questionCount: 32 });
    expect(math?.books.map((b) => b.book)).toEqual(['必修1', '三年级上册', '必修10', '']);
    const grade3 = math?.books.find((b) => b.book === '三年级上册');
    expect(grade3).toMatchObject({ bankCount: 4, questionCount: 10 });
    expect(grade3?.sections.map((s) => s.section)).toEqual(['第一章 测量', '第二章 分数', '第十章 总复习', '']);
    const unboundBook = math?.books.find((b) => b.book === '');
    expect(unboundBook).toMatchObject({ bankCount: 1, questionCount: 5 });
    expect(unboundBook?.sections).toEqual([{ section: '第一章 集合', bankCount: 1, questionCount: 5 }]);

    const chinese = body.courses.find((c) => c.name === '语文');
    expect(chinese).toMatchObject({ id: 2, bankCount: 1, questionCount: 2 });
    expect(chinese?.books.map((b) => b.book)).toEqual(['七年级上册']);
  });

  it('kind=paper 时课程视图为空（试卷都没挂课程）', async () => {
    const body = (await getCatalog('?view=course&kind=paper')) as CourseCatalog;
    expect(body.courses).toEqual([]);
  });

  it('未登录只读也要求会话', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/banks/catalog-sections' });
    expect(anon.statusCode).toBe(401);
  });
});
