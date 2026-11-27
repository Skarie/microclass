/**
 * PG 集成测试：组卷选题树 facets（`scope=course` / `scope=all`）+ 知识点清单。
 *
 * 只在 `MC_PG_TEST_URL` 存在时运行（默认 vitest 仍是纯 sqlite）：
 *   MC_PG_TEST_URL=postgres://microclass:***@db:5432/microclass_test \
 *     npx vitest run apps/api/test/pg-facets.test.ts
 *
 * 为什么需要它：2.4.4 线上 `GET /exams/:id/facets` 在 PG 下必 500，根因是
 *   `SELECT ... COALESCE(b.name,'') ... GROUP BY q.bank_id` —— PG 要求 SELECT 的非聚合
 *   表达式出现在 GROUP BY 里；SQLite 宽松，E2E 与 sqlite 用例都抓不到。本文件在**真实 PG**
 *   上装配整站，直接打 HTTP 路由（与生产同一条路径），锁住两个 scope 的 200 与分组口径。
 *
 * 同时覆盖「分组键必须与 SELECT 表达式逐字一致」：题目的 book/chapter/point 留 NULL，
 * 若 GROUP BY 写成裸列名（PG 会先匹配输入列），NULL 与 '' 会被拆成两组、树上出现两个「未标注」。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import '../src/db/pg/pool.js'; // 副作用：int8（OID 20）→ number 的全局 parser
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { getAsyncDb } from '../src/db/driver.js';
import type { AsyncDb } from '../src/db/async.js';
import { closePg, pgEnabled, resetPgSchema } from './helpers/pgTestDb.js';

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

describe.skipIf(!pgEnabled)('PG：选题树 facets（scope=course / all）', () => {
  let app: FastifyInstance;
  let config: AppConfig | null = null;
  let sqliteDb: Db | null = null;
  let db: AsyncDb;
  let dataDir = '';
  let cookie = '';
  let courseId = 0;
  let otherCourseId = 0;
  let examId = 0;
  let bankA = 0;
  let bankB = 0;

  /** 直插题目：册次/章节/知识点可给 null（SQLite 下 E2E 造不出来的边界） */
  async function addQuestion(input: {
    bankId: number;
    type: string;
    stem: string;
    courseId: number;
    book: string | null;
    chapter: string | null;
    point: string | null;
    difficulty: 'easy' | 'medium' | 'hard';
  }): Promise<number> {
    const score = input.difficulty === 'easy' ? 30 : input.difficulty === 'hard' ? 85 : 55;
    const row = await db.get<{ id: number | string }>(
      `INSERT INTO questions (bank_id, type, stem, course_id, book, chapter, point, difficulty, difficulty_score)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
        input.bankId,
        input.type,
        input.stem,
        input.courseId,
        input.book,
        input.chapter,
        input.point,
        input.difficulty,
        score,
      ],
    );
    return Number(row?.id ?? 0);
  }

  beforeAll(async () => {
    // 1) 重建测试库 schema（库名必须含 test，否则 helper 拒绝 DROP SCHEMA）
    const seed = await resetPgSchema();
    await closePg(seed);

    // 2) 以 MC_DB=pg 装配整站（与生产同一套路由/仓储/驱动）
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-pg-facets-'));
    config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
      MC_LOG_LEVEL: 'silent',
      MC_DB: 'pg',
      MC_PG_URL: process.env.MC_PG_TEST_URL ?? '',
    });
    sqliteDb = new Db(':memory:');
    const built = await buildApp(config, { db: sqliteDb });
    app = built.app;
    await app.ready();
    db = getAsyncDb(config, sqliteDb);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    expect(login.statusCode, login.body).toBe(200);
    const c = login.cookies.find((x) => x.name === 'microclass_sid');
    cookie = c ? `microclass_sid=${c.value}` : '';
    expect(cookie).toContain('microclass_sid=');

    // 3) 造两门课：scope=course 只看本考试课程，scope=all 跨课程
    const course = await db.get<{ id: number | string }>('INSERT INTO courses (name) VALUES (?) RETURNING id', [
      'PG 选题课程',
    ]);
    courseId = Number(course?.id ?? 0);
    const other = await db.get<{ id: number | string }>('INSERT INTO courses (name) VALUES (?) RETURNING id', [
      'PG 跨课程',
    ]);
    otherCourseId = Number(other?.id ?? 0);
    const a = await db.get<{ id: number | string }>(
      'INSERT INTO banks (name, course_id, kind) VALUES (?,?,?) RETURNING id',
      ['PG 题库A', courseId, 'chapter'],
    );
    bankA = Number(a?.id ?? 0);
    const b = await db.get<{ id: number | string }>(
      'INSERT INTO banks (name, course_id, kind) VALUES (?,?,?) RETURNING id',
      ['PG 题库B', otherCourseId, 'chapter'],
    );
    bankB = Number(b?.id ?? 0);
    const exam = await db.get<{ id: number | string }>(
      'INSERT INTO exams (course_id, title, status) VALUES (?,?,?) RETURNING id',
      [courseId, 'PG 选题考试', 'draft'],
    );
    examId = Number(exam?.id ?? 0);

    await addQuestion({
      bankId: bankA,
      type: 'single',
      stem: 'PG 题1',
      courseId,
      book: '一年级下册',
      chapter: '第一章 加与减',
      point: '加法',
      difficulty: 'easy',
    });
    await addQuestion({
      bankId: bankA,
      type: 'single',
      stem: 'PG 题2',
      courseId,
      book: '一年级下册',
      chapter: '第一章 加与减',
      point: '加法',
      difficulty: 'hard',
    });
    await addQuestion({
      bankId: bankA,
      type: 'fill',
      stem: 'PG 题3',
      courseId,
      book: '一年级下册',
      chapter: '第二章 生活中的数',
      point: '数的认识',
      difficulty: 'medium',
    });
    // 册次/章节/知识点全 NULL：树上必须归到「未标注」，且只能出现一棵
    await addQuestion({
      bankId: bankA,
      type: 'judge',
      stem: 'PG 题4（未标注）',
      courseId,
      book: null,
      chapter: null,
      point: null,
      difficulty: 'easy',
    });
    await addQuestion({
      bankId: bankB,
      type: 'single',
      stem: 'PG 题5',
      courseId: otherCourseId,
      book: '二年级上册',
      chapter: '第一章 认识图形',
      point: '图形',
      difficulty: 'easy',
    });
    await addQuestion({
      bankId: bankB,
      type: 'judge',
      stem: 'PG 题6',
      courseId: otherCourseId,
      book: '二年级上册',
      chapter: '第一章 认识图形',
      point: '图形',
      difficulty: 'hard',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    // 关掉进程级 PG 池，否则 vitest 会因 idle 连接不退出
    if (config && sqliteDb) await getAsyncDb(config, sqliteDb).close();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('scope=course：200，只统计本课程，册次 → 章节分组正确', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/facets?scope=course`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      total: number;
      books: { book: string; label: string; count: number; chapters: { chapter: string; count: number }[] }[];
      types: { type: string; count: number }[];
      levels: { level: string; count: number }[];
      banks: { id: number; name: string; count: number }[];
    }>(res);
    expect(body.total).toBe(4);
    expect(body.books.map((b) => b.book)).not.toContain('二年级上册');
    const book = body.books.find((b) => b.book === '一年级下册');
    expect(book?.count).toBe(3);
    expect(book?.chapters.find((c) => c.chapter === '第一章 加与减')?.count).toBe(2);
    expect(book?.chapters.find((c) => c.chapter === '第二章 生活中的数')?.count).toBe(1);
    // NULL 册次/章节：只有一棵「未标注」（GROUP BY 与 SELECT 表达式一致，不会拆成两棵）
    const none = body.books.filter((b) => b.book === '__none__');
    expect(none).toHaveLength(1);
    expect(none[0]?.label).toBe('（未标注册次）');
    expect(none[0]?.count).toBe(1);
    expect(none[0]?.chapters).toEqual([{ chapter: '__none__', label: '（未标注章节）', count: 1 }]);
    expect(body.types.find((t) => t.type === 'single')?.count).toBe(2);
    expect(body.types.find((t) => t.type === 'judge')?.count).toBe(1);
    expect(body.levels.find((l) => l.level === 'easy')?.count).toBe(2);
    expect(body.levels.find((l) => l.level === 'hard')?.count).toBe(1);
    // 题库维度：b.name 不在 GROUP BY 里（2.4.4 500 的根因），必须靠聚合取回名字
    expect(body.banks).toHaveLength(1);
    expect(body.banks[0]?.id).toBe(bankA);
    expect(body.banks[0]?.name).toBe('PG 题库A');
    expect(body.banks[0]?.count).toBe(4);
  });

  it('scope=all：200，跨课程汇总，两个题库都带名字', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/facets?scope=all`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = json<{
      total: number;
      books: { book: string; count: number }[];
      banks: { id: number; name: string; count: number }[];
    }>(res);
    expect(body.total).toBe(6);
    expect(body.books.find((b) => b.book === '一年级下册')?.count).toBe(3);
    expect(body.books.find((b) => b.book === '二年级上册')?.count).toBe(2);
    expect(body.books.filter((b) => b.book === '__none__')).toHaveLength(1);
    expect(body.banks).toHaveLength(2);
    const names = body.banks.map((b) => b.name).sort();
    expect(names).toEqual(['PG 题库A', 'PG 题库B']);
    expect(body.banks.find((b) => b.id === bankB)?.count).toBe(2);
  });

  it('知识点清单（pointsOf）两个 scope 都不报错，NULL 分组只出现一次', async () => {
    const scoped = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/points?scope=course`,
      headers: { cookie },
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const scopedBody = json<{ points: { point: string; count: number }[] }>(scoped);
    expect(scopedBody.points.find((p) => p.point === '加法')?.count).toBe(2);
    expect(scopedBody.points.filter((p) => p.point === '__none__')).toHaveLength(1);

    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/exams/${examId}/points?scope=all`,
      headers: { cookie },
    });
    expect(all.statusCode, all.body).toBe(200);
    const allBody = json<{ points: { point: string; label: string; count: number }[] }>(all);
    expect(allBody.points.find((p) => p.point === '图形')?.count).toBe(2);
    const none = allBody.points.find((p) => p.point === '__none__');
    expect(none?.label).toBe('（未标注知识点）');
    expect(none?.count).toBe(1);
  });
});
