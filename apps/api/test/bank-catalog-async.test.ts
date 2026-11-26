/**
 * 题库目录聚合的方言契约（2026-11-27 切流后在真 PG 上炸出来的两个 bug）。
 *
 * 事故：`/banks/catalog` 与 `/banks/catalog-sections?view=book` 在 `MC_DB=pg` 下 500：
 *   1. `?1` 编号占位符——`AsyncDb` 的 `?` → `$n` 重写只认裸 `?`，`?1` 被改成 `$11`，
 *      PG 报 `could not determine data type of parameter $1`；
 *   2. `HAVING bankCount > 0` / `ORDER BY bankCount DESC` 引用**裸 camelCase 别名**——
 *      PG 折叠成 `bankcount`，报 `column "bankcount" does not exist`（#29 的「引用侧」，
 *      收尾批次只扫了 `AS camelCase`，没扫别名引用）。
 *
 * 这里钉三件事：源码守卫（禁止 `?N`、禁止 HAVING/ORDER BY 裸驼峰别名）+ sqlite 功能对照
 * （7 个聚合函数在 kind='' / kind='xxx' 下的计数）；真 PG 行为见
 * `pg-final-repos.test.ts` 的「banks 目录聚合」用例（需 `MC_PG_TEST_URL`）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../src/db/async.js';
import { catalogCourses, catalogUnbound, catalogUnboundBooks } from '../src/db/repositories/bankCatalogQueries.js';
import {
  banksMissingSection,
  catalogSectionsByBook,
  catalogSectionsByCourse,
} from '../src/db/repositories/bankSectionQueries.js';
import { courseBindingStats } from '../src/db/repositories/bankBindingQueries.js';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('方言源码守卫', () => {
  const files = walk('apps/api/src');

  it('禁止 ?N 编号占位符（AsyncDb 只重写裸 ?）', () => {
    const bad = files
      .filter((file) => /\?[0-9]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative('apps/api/src', file).replace(/\\/g, '/'));
    expect(bad).toEqual([]);
  });

  it('禁止 HAVING / ORDER BY 直接引用裸 camelCase 别名', () => {
    const bad: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // 驼峰别名 = 小写开头、后面出现大写（`bankCount`）；`COUNT(` / `CASE` / `question_id` 都不算
      for (const m of text.matchAll(/\b(?:HAVING|ORDER\s+BY)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        const token = m[1] ?? '';
        if (!/^[a-z][A-Za-z0-9]*[A-Z]/.test(token)) continue;
        bad.push(`${path.relative('apps/api/src', file).replace(/\\/g, '/')}: ${(m[0] ?? '').trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('sqlite 真库：目录聚合计数的 kind 过滤', () => {
  let app: BuiltApp;
  let dataDir: string;
  let adb: AsyncDb;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-catalog-async-'));
    const config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
      MC_LOG_LEVEL: 'silent',
    });
    app = await buildApp(config, { db: new Db(':memory:') });
    await app.app.ready();
    adb = createSqliteAsyncDb(app.deps.db);
    const db = app.deps.db;
    db.run("INSERT INTO courses (id, name) VALUES (1, '课程一')");
    db.run("INSERT INTO lessons (id, title, course_id, group_name, sort) VALUES (1, '课时一', 1, '第一章', 1)");
    // 1) 课时库（有课程、有课时） 2) 章节库（有课程、无课时） 3) 未归属课程
    db.run(
      "INSERT INTO banks (id, name, course_id, lesson_id, kind, book, section, question_count) VALUES (1, '课时库', 1, 1, 'lesson', '八年级上', '第一章', 10)",
    );
    db.run(
      "INSERT INTO banks (id, name, course_id, lesson_id, kind, book, section, question_count) VALUES (2, '章节库', 1, NULL, 'chapter', '八年级上', '第二章', 5)",
    );
    db.run(
      "INSERT INTO banks (id, name, course_id, lesson_id, kind, book, section, question_count) VALUES (3, '未归属库', NULL, NULL, 'chapter', '八年级下', '', 7)",
    );
  });

  afterAll(async () => {
    await app.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('catalogCourses：全部 / 按 kind 过滤（HAVING 走表达式，不引用别名）', async () => {
    const all = await catalogCourses(adb, '');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 1, bankCount: 2, questionCount: 15, chapterCount: 1 });
    const chapters = await catalogCourses(adb, 'chapter');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ bankCount: 1, questionCount: 5 });
  });

  it('catalogUnbound / catalogUnboundBooks：未归属统计 + 按册次分组', async () => {
    expect(await catalogUnbound(adb, '')).toEqual({ bankCount: 1, questionCount: 7 });
    expect(await catalogUnbound(adb, 'lesson')).toEqual({ bankCount: 0, questionCount: 0 });
    expect(await catalogUnboundBooks(adb, '')).toEqual([{ book: '八年级下', bankCount: 1, questionCount: 7 }]);
  });

  it('catalogSectionsByBook：册次→章节 + kind 过滤 + 未归类标记', async () => {
    const all = await catalogSectionsByBook(adb, '');
    expect(all.view).toBe('book');
    expect(all.books.map((b) => b.book)).toEqual(['八年级上', '八年级下']);
    const firstBook = all.books[0];
    expect(firstBook).toMatchObject({ bankCount: 2, questionCount: 15, isUnbound: false });
    expect(firstBook?.sections.map((s) => [s.section, s.bankCount])).toEqual([
      ['第一章', 1],
      ['第二章', 1],
    ]);
    expect(all.books[1]).toMatchObject({ book: '八年级下', isUnbound: true, bankCount: 1 });

    const lessons = await catalogSectionsByBook(adb, 'lesson');
    expect(lessons.books.map((b) => [b.book, b.bankCount])).toEqual([['八年级上', 1]]);
  });

  it('catalogSectionsByCourse / banksMissingSection / courseBindingStats', async () => {
    const byCourse = await catalogSectionsByCourse(adb, '');
    expect(byCourse.view).toBe('course');
    const firstCourse = byCourse.courses[0];
    expect(firstCourse).toMatchObject({ id: 1, name: '课程一', bankCount: 2, questionCount: 15 });

    const missing = await banksMissingSection(adb, '');
    expect(missing.map((r) => r.id)).toEqual([3]);

    expect((await courseBindingStats(adb, ''))[0]).toEqual({ bound: 2, unbound: 1, banks: 3 });
    expect((await courseBindingStats(adb, 'lesson'))[0]).toEqual({ bound: 1, unbound: 0, banks: 1 });
  });
});
