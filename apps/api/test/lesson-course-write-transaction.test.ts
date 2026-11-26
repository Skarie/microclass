/**
 * lessons / courses 域写方法的事务语义（P0 阶段 2）。
 *
 * 背景：两个仓储从同步 `Db` 迁到 `AsyncDb`，写方法改 `INSERT … RETURNING id`、
 * 多语句改 `AsyncDb.transaction(async tx)`。语义必须与迁移前一致：
 * **回调里任何一条失败，前面已执行的写也要回滚**（sqlite BEGIN IMMEDIATE；PG 单连接）。
 *
 * 本文件默认只跑 sqlite（内存库）；
 * PG 分支需要 `MC_PG_TEST_URL`（按硬规则不在生产机器上跑，留给切流预演/CI）：
 *   MC_PG_TEST_URL=postgres://… npx vitest run apps/api/test/lesson-course-write-transaction.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import { LessonRepository } from '../src/db/repositories/lessonRepository.js';
import { CourseRepository } from '../src/db/repositories/courseRepository.js';
import type { AsyncDb } from '../src/db/async.js';

let dataDir: string;
let built: BuiltApp;
let db: Db;
let asyncDb: AsyncDb;
let lessons: LessonRepository;
let courses: CourseRepository;

const USER_ID = 101;

/** 造课时；sort 避开 1，避免 reorder 用例的失败触发器误伤 */
async function makeLesson(title: string, courseId: number | null = null, sort = 0): Promise<number> {
  return lessons.create({
    title,
    videoKind: 'local',
    mediaRoot: 'root-a',
    videoPath: `${title}.mp4`,
    groupName: '第一章',
    courseId,
    sort,
  });
}

async function makeCourse(name: string): Promise<number> {
  return courses.create({ name, published: true });
}

async function dropTrigger(name: string): Promise<void> {
  await asyncDb.run(`DROP TRIGGER IF EXISTS ${name}`);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-lesson-tx-'));
  const config = loadConfig({
    ...process.env,
    MC_ENV: 'test',
    MC_DATA_DIR: dataDir,
    MC_LOG_LEVEL: 'silent',
    MC_ADMIN_USER: 'admin',
    MC_ADMIN_PASS: 'admin123',
  });
  db = new Db(':memory:');
  built = await buildApp(config, { db });
  await built.app.ready();
  asyncDb = getAsyncDb(config, db);
  lessons = new LessonRepository(db, asyncDb);
  courses = new CourseRepository(db, asyncDb);
});

afterAll(async () => {
  await built.app.close();
  resetAsyncDbCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('LessonRepository：写方法走 AsyncDb（RETURNING id / 事务）', () => {
  it('create → RETURNING id，findById 能读回', async () => {
    const id = await makeLesson('自增用例');
    expect(id).toBeGreaterThan(0);
    const row = await lessons.findById(id);
    expect(row?.title).toBe('自增用例');
    expect(row?.source).toBe('manual');
  });

  it('update → 字段全部覆盖（含课程归属）', async () => {
    const courseId = await makeCourse('更新用课程');
    const id = await makeLesson('待更新');
    await lessons.update(id, {
      title: '更新后',
      description: '说明',
      videoKind: 'embed',
      videoPath: 'https://example.com/v',
      sort: 3,
      groupName: '第二章',
      courseId,
    });
    const row = await lessons.findById(id);
    expect(row?.title).toBe('更新后');
    expect(row?.video_kind).toBe('embed');
    expect(row?.course_id).toBe(courseId);
  });

  it('delete → 课时与进度一起删（同事务）', async () => {
    const id = await makeLesson('待删除');
    await asyncDb.run('INSERT INTO lesson_progress (user_id, lesson_id, position) VALUES (?,?,?)', [USER_ID, id, 12]);
    await lessons.delete(id);
    expect(await lessons.findById(id)).toBeUndefined();
    const progress = await asyncDb.get('SELECT 1 AS x FROM lesson_progress WHERE lesson_id = ?', [id]);
    expect(progress).toBeUndefined();
  });

  it('deleteMany → 第二条语句失败时，课时删除也回滚', async () => {
    const a = await makeLesson('批量删A');
    const b = await makeLesson('批量删B');
    await asyncDb.run('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?,?)', [USER_ID, a]);
    // 让「删进度」这一步必然失败，验证前面「删课时」被回滚
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_progress BEFORE DELETE ON lesson_progress BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(lessons.deleteMany([a, b])).rejects.toThrow();
      expect(await lessons.findById(a)).toBeDefined();
      expect(await lessons.findById(b)).toBeDefined();
    } finally {
      await dropTrigger('tx_fail_progress');
    }
    expect(await lessons.deleteMany([a, b])).toBe(2);
    expect(await lessons.findById(a)).toBeUndefined();
  });

  it('reorder → 中途一条失败时整批 sort 回滚', async () => {
    const a = await makeLesson('排序A', null, 0);
    const b = await makeLesson('排序B', null, 7);
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_reorder BEFORE UPDATE ON lessons WHEN NEW.sort = 1 BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(lessons.reorder([a, b])).rejects.toThrow();
      expect((await lessons.findById(a))?.sort).toBe(0);
      expect((await lessons.findById(b))?.sort).toBe(7);
    } finally {
      await dropTrigger('tx_fail_reorder');
    }
    expect(await lessons.reorder([a, b])).toBe(2);
    expect((await lessons.findById(a))?.sort).toBe(0);
    expect((await lessons.findById(b))?.sort).toBe(1);
  });

  it('batchAssign → 空数组 / 不存在的 id 返回 0；存在的按章节改绑', async () => {
    const courseId = await makeCourse('改绑课程');
    const id = await makeLesson('改绑课时');
    expect(await lessons.batchAssign([], courseId)).toBe(0);
    expect(await lessons.batchAssign([999999], courseId)).toBe(0);
    expect(await lessons.batchAssign([id], courseId, '新章节')).toBe(1);
    const row = await lessons.findById(id);
    expect(row?.course_id).toBe(courseId);
    expect(row?.group_name).toBe('新章节');
  });

  it('withProgress → 按用户合并进度（缺省为 null）', async () => {
    const withRow = await makeLesson('有进度');
    const without = await makeLesson('无进度');
    await asyncDb.run(
      'INSERT INTO lesson_progress (user_id, lesson_id, position, duration, finished, quiz_done, quiz_best) VALUES (?,?,?,?,?,?,?)',
      [USER_ID, withRow, 30, 100, 1, 1, 88],
    );
    const a = await lessons.findById(withRow);
    const b = await lessons.findById(without);
    if (!a || !b) throw new Error('课时未创建成功');
    const rows = await lessons.withProgress([a, b], USER_ID);
    expect(rows[0]?.progress).toMatchObject({ position: 30, finished: 1, quiz_best: 88 });
    expect(rows[1]?.progress).toBeNull();
  });
});

describe('CourseRepository：写方法走 AsyncDb（RETURNING id / 事务）', () => {
  it('create → RETURNING id；update 覆盖字段', async () => {
    const id = await makeCourse('新课程');
    expect(id).toBeGreaterThan(0);
    await courses.update(id, { name: '改名后', published: false, sort: 5 });
    const row = await courses.findById(id);
    expect(row?.name).toBe('改名后');
    expect(row?.published).toBe(0);
  });

  it('delete → 课时回到未归类、课程消失（同事务）', async () => {
    const courseId = await makeCourse('待删课程');
    const lessonId = await makeLesson('归属课时', courseId);
    await courses.delete(courseId);
    expect(await courses.findById(courseId)).toBeUndefined();
    expect((await lessons.findById(lessonId))?.course_id).toBeNull();
  });

  it('delete → 删课程失败时，「课时解绑」也回滚', async () => {
    const courseId = await makeCourse('回滚课程');
    const lessonId = await makeLesson('回滚课时', courseId);
    await asyncDb.run("CREATE TRIGGER tx_fail_course BEFORE DELETE ON courses BEGIN SELECT RAISE(ABORT, 'boom'); END");
    try {
      await expect(courses.delete(courseId)).rejects.toThrow();
      expect(await courses.findById(courseId)).toBeDefined();
      expect((await lessons.findById(lessonId))?.course_id).toBe(courseId);
    } finally {
      await dropTrigger('tx_fail_course');
    }
  });

  it('toggleFavorite → 先收藏再取消（同一事务内先查再写）', async () => {
    const courseId = await makeCourse('收藏课程');
    expect(await courses.isFavorite(USER_ID, courseId)).toBe(false);
    expect(await courses.toggleFavorite(USER_ID, courseId)).toBe(true);
    expect(await courses.isFavorite(USER_ID, courseId)).toBe(true);
    expect(await courses.toggleFavorite(USER_ID, courseId)).toBe(false);
    expect(await courses.isFavorite(USER_ID, courseId)).toBe(false);
  });

  it('分类：createCategory / findCategoryByName / deleteCategory（课程解绑分类）', async () => {
    const categoryId = await courses.createCategory('测试分类');
    expect(categoryId).toBeGreaterThan(0);
    expect((await courses.findCategoryByName('测试分类'))?.id).toBe(categoryId);
    const courseId = await courses.create({ name: '带分类课程', categoryId });
    expect((await courses.findById(courseId))?.category_id).toBe(categoryId);
    await courses.deleteCategory(categoryId);
    expect((await courses.findById(courseId))?.category_id).toBeNull();
    expect(await courses.findCategoryByName('测试分类')).toBeUndefined();
  });

  it('aggregate / orphanAggregate → 课时数、进度、收藏与分类名聚合一致', async () => {
    const categoryId = await courses.createCategory('聚合分类');
    const courseId = await courses.create({ name: '聚合课程', categoryId, published: true });
    const done = await makeLesson('聚合课时1', courseId);
    const quizzed = await makeLesson('聚合课时2', courseId);
    await makeLesson('未归类课时', null);
    await asyncDb.run('INSERT INTO lesson_progress (user_id, lesson_id, finished, quiz_done) VALUES (?,?,?,?)', [
      USER_ID,
      done,
      1,
      0,
    ]);
    await asyncDb.run('INSERT INTO lesson_progress (user_id, lesson_id, finished, quiz_done) VALUES (?,?,?,?)', [
      USER_ID,
      quizzed,
      0,
      1,
    ]);
    await asyncDb.run('INSERT INTO favorites (user_id, course_id) VALUES (?,?)', [USER_ID, courseId]);

    const agg = (await courses.aggregate({ forUserId: USER_ID, includeDrafts: false })).find((c) => c.id === courseId);
    // 只统计本课程的课时；未归类课时不计入 total
    expect(agg).toMatchObject({ category_name: '聚合分类', total: 2, finished: 1, quiz: 1, fav: true });

    const orphanRows = await asyncDb.all<{ id: number }>('SELECT id FROM lessons WHERE course_id IS NULL');
    const orphanAgg = await courses.orphanAggregate(USER_ID);
    expect(orphanAgg.total).toBe(orphanRows.length);
  });

  it('listPublished → 只出 published=1 的课程', async () => {
    const draft = await courses.create({ name: '未发布课程', published: false });
    const published = await courses.create({ name: '已发布课程', published: true });
    const ids = (await courses.listPublished()).map((c) => c.id);
    expect(ids).toContain(published);
    expect(ids).not.toContain(draft);
  });
});

/* ------------------------------------------------------------------ */
/* PG 分支：需要 MC_PG_TEST_URL；本机不跑（硬规则），留给切流预演/CI   */
/* ------------------------------------------------------------------ */
const PG_URL = process.env.MC_PG_TEST_URL ?? '';

describe.skipIf(!PG_URL)('PG：同一套 SQL 的 RETURNING / 事务语义', () => {
  it('INSERT … RETURNING id 与事务回滚', async () => {
    const { createPgAsyncDb } = await import('../src/db/async.js');
    const { createPgPool } = await import('../src/db/pg/pool.js');
    const pg = createPgAsyncDb(createPgPool({ url: PG_URL, max: 2 }));
    try {
      await pg.run('DROP TABLE IF EXISTS lesson_tx_probe');
      await pg.run('CREATE TABLE lesson_tx_probe (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title text)');
      const row = await pg.get<{ id: number }>("INSERT INTO lesson_tx_probe (title) VALUES ('第一课') RETURNING id");
      expect(Number(row?.id)).toBeGreaterThan(0);

      await expect(
        pg.transaction(async (tx) => {
          await tx.run("UPDATE lesson_tx_probe SET title = '改过' WHERE id = ?", [row?.id]);
          throw new Error('模拟中途失败');
        }),
      ).rejects.toThrow('模拟中途失败');
      expect(
        (await pg.get<{ title: string }>('SELECT title FROM lesson_tx_probe WHERE id = ?', [row?.id]))?.title,
      ).toBe('第一课');
      await pg.run('DROP TABLE lesson_tx_probe');
    } finally {
      await pg.close();
    }
  });
});
