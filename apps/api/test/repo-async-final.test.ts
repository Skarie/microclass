/**
 * 收尾批次的契约测试（sqlite 侧，默认跑）：5 个仓储「全部走 AsyncDb」+ 方言 + 路由 await。
 *
 * 钉住四件事：
 *   1. 方法返回 Promise，且**一次都不碰同步 Db**（PG 模式下同步 Db 不存在，碰它 = 跨库混合读写）；
 *   2. PG 的 int8（COUNT/SUM/水位/自增 id）在仓储边界收敛成 number（方言 #17），
 *      否则接口会返回 `"3"` 而不是 `3`，前端比较/求和全错；
 *   3. 新加的方言片段按驱动生成（#26 nowText / #6 nocase / #27 nullSafeEq / #28 insertionOrder）；
 *   4. 路由层 `await` 到位：漏 await 时 Fastify 会把 Promise 序列化成 `{}`（不是报错，最难发现）。
 *
 * 真 PG 上的行为见 `pg-final-repos.test.ts`（需要 `MC_PG_TEST_URL`）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import type { AsyncDb, DbDriverName } from '../src/db/async.js';
import { insertionOrder, nocase, nowText, nullSafeEq } from '../src/db/sql.js';
import { AttemptRepository } from '../src/db/repositories/attemptRepository.js';
import { ProgressRepository } from '../src/db/repositories/progressRepository.js';
import { QuestionConflictRepository } from '../src/db/repositories/questionConflictRepository.js';
import { QuestionGroupRepository } from '../src/db/repositories/questionGroupRepository.js';
import { KnowledgeRepository } from '../src/db/repositories/knowledgeRepository.js';
import { TagRepository } from '../src/db/repositories/tagRepository.js';
import { BankFolderRepository } from '../src/db/repositories/bankFolderQueries.js';

/** 异步端口桩：记录 SQL，返回值可定制 */
function stubAsyncDb(
  driver: DbDriverName = 'sqlite',
  handlers: { all?: (sql: string) => unknown[]; get?: (sql: string) => unknown } = {},
): { adb: AsyncDb; sqls: string[] } {
  const sqls: string[] = [];
  const all = async (sql: string): Promise<unknown[]> => {
    sqls.push(sql);
    return handlers.all?.(sql) ?? [];
  };
  const get = async (sql: string): Promise<unknown> => {
    sqls.push(sql);
    return handlers.get?.(sql);
  };
  const run = async (sql: string): Promise<{ changes: number }> => {
    sqls.push(sql);
    return { changes: 1 };
  };
  const adb = {
    driver,
    all,
    get,
    run,
    transaction: async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(adb),
    close: async () => undefined,
  } as unknown as AsyncDb;
  return { adb, sqls };
}

describe('收尾批次：5 个仓储的方法都返回 Promise，且只经 AsyncDb', () => {
  const conflict = (adb: AsyncDb): QuestionConflictRepository => new QuestionConflictRepository(adb);
  const cases: { name: string; call: (adb: AsyncDb) => Promise<unknown> }[] = [
    { name: 'conflicts.sync', call: (a) => conflict(a).sync() },
    { name: 'conflicts.staleness', call: (a) => conflict(a).staleness() },
    { name: 'conflicts.list', call: (a) => conflict(a).list({}) },
    { name: 'conflicts.questions', call: (a) => conflict(a).questions('h') },
    { name: 'conflicts.answers', call: (a) => conflict(a).answers('h') },
    { name: 'conflicts.answersFor', call: (a) => conflict(a).answersFor(['h']) },
    { name: 'conflicts.find', call: (a) => conflict(a).find('h') },
    { name: 'conflicts.upsertStatus', call: (a) => conflict(a).upsertStatus('h', 'pending', '', { id: 1, name: 'x' }) },
    { name: 'conflicts.counts', call: (a) => conflict(a).counts() },
    { name: 'groups.list', call: (a) => new QuestionGroupRepository(a).list('') },
    { name: 'groups.findById', call: (a) => new QuestionGroupRepository(a).findById(1) },
    { name: 'groups.create', call: (a) => new QuestionGroupRepository(a).create('t', '', null) },
    { name: 'groups.touch', call: (a) => new QuestionGroupRepository(a).touch(1) },
    { name: 'groups.items', call: (a) => new QuestionGroupRepository(a).items(1) },
    { name: 'groups.itemRoles', call: (a) => new QuestionGroupRepository(a).itemRoles(1) },
    { name: 'groups.countItems', call: (a) => new QuestionGroupRepository(a).countItems(1) },
    { name: 'groups.nextSort', call: (a) => new QuestionGroupRepository(a).nextSort(1) },
    {
      name: 'groups.existingQuestionIds',
      call: (a) => new QuestionGroupRepository(a).existingQuestionIds([1]),
    },
    { name: 'groups.upsertItem', call: (a) => new QuestionGroupRepository(a).upsertItem(1, 2, 'stem', 0) },
    { name: 'groups.remove', call: (a) => new QuestionGroupRepository(a).remove(1) },
    { name: 'groups.questionExists', call: (a) => new QuestionGroupRepository(a).questionExists(1) },
    { name: 'knowledge.listByLesson', call: (a) => new KnowledgeRepository(a).listByLesson(1) },
    { name: 'knowledge.listByCourse', call: (a) => new KnowledgeRepository(a).listByCourse(1) },
    { name: 'knowledge.findById', call: (a) => new KnowledgeRepository(a).findById(1) },
    {
      name: 'knowledge.create',
      call: (a) => new KnowledgeRepository(a).create({ lessonId: 1, title: 't', kind: 'text' }),
    },
    {
      name: 'knowledge.createMany',
      call: (a) => new KnowledgeRepository(a).createMany([{ lessonId: 1, title: 't', kind: 'text' }]),
    },
    { name: 'knowledge.delete', call: (a) => new KnowledgeRepository(a).delete(1) },
    { name: 'knowledge.maxSort', call: (a) => new KnowledgeRepository(a).maxSort({ lessonId: 1 }) },
    {
      name: 'knowledge.existsTextTitle',
      call: (a) => new KnowledgeRepository(a).existsTextTitle({ lessonId: 1 }, 't'),
    },
    { name: 'tags.list', call: (a) => new TagRepository(a).list('') },
    { name: 'tags.findByName', call: (a) => new TagRepository(a).findByName('x') },
    { name: 'tags.create', call: (a) => new TagRepository(a).create({ name: 'x', note: '', createdBy: null }) },
    { name: 'tags.countQuestions', call: (a) => new TagRepository(a).countQuestions(1) },
    { name: 'tags.existingTagIds', call: (a) => new TagRepository(a).existingTagIds([1]) },
    { name: 'tags.existingQuestionIds', call: (a) => new TagRepository(a).existingQuestionIds([1]) },
    { name: 'tags.tagsOfQuestion', call: (a) => new TagRepository(a).tagsOfQuestion(1) },
    { name: 'tags.tagIdsOfQuestions', call: (a) => new TagRepository(a).tagIdsOfQuestions([1]) },
    { name: 'tags.setQuestionTags', call: (a) => new TagRepository(a).setQuestionTags(1, [2]) },
    { name: 'tags.batch', call: (a) => new TagRepository(a).batch([1], [2], 'add') },
    { name: 'folders.all', call: (a) => new BankFolderRepository(a).all() },
    { name: 'folders.findById', call: (a) => new BankFolderRepository(a).findById(1) },
    { name: 'folders.findByParentAndName', call: (a) => new BankFolderRepository(a).findByParentAndName(null, 'x') },
    { name: 'folders.directCounts', call: (a) => new BankFolderRepository(a).directCounts() },
    { name: 'folders.unfiled', call: (a) => new BankFolderRepository(a).unfiled() },
    { name: 'folders.childCount', call: (a) => new BankFolderRepository(a).childCount(1) },
    { name: 'folders.bankCount', call: (a) => new BankFolderRepository(a).bankCount(1) },
    { name: 'folders.nextSort', call: (a) => new BankFolderRepository(a).nextSort(null) },
    { name: 'folders.remove', call: (a) => new BankFolderRepository(a).remove(1) },
    { name: 'folders.courseSummary', call: (a) => new BankFolderRepository(a).courseSummary() },
  ];

  for (const { name, call } of cases) {
    it(`${name}() 返回 Promise，且不碰同步 Db`, async () => {
      const { adb, sqls } = stubAsyncDb();
      const pending = call(adb);
      expect(pending).toBeInstanceOf(Promise);
      await pending;
      expect(sqls.length).toBeGreaterThan(0);
    });
  }
});

describe('收尾批次：PG int8 在仓储边界收敛成 number（#17）', () => {
  it('台账计数 / 组计数 / 标签题目数 / 文件夹汇总都是 number', async () => {
    const count = stubAsyncDb('pg', { all: () => [{ status: 'pending', c: '3' }] });
    expect((await new QuestionConflictRepository(count.adb).counts()).total).toBe(3);

    const items = stubAsyncDb('pg', { get: () => ({ c: '2' }) });
    expect(await new QuestionGroupRepository(items.adb).countItems(1)).toBe(2);

    const sort = stubAsyncDb('pg', { get: () => ({ sort: '5' }) });
    expect(await new QuestionGroupRepository(sort.adb).nextSort(1)).toBe(5);

    const tags = stubAsyncDb('pg', {
      all: () => [{ id: '1', name: 'A', note: '', created_at: '', created_by: null, questionCount: '7' }],
    });
    expect((await new TagRepository(tags.adb).list('')).at(0)?.questionCount).toBe(7);

    const folders = stubAsyncDb('pg', { all: () => [{ folderId: '2', bankCount: '4', questionCount: '9' }] });
    const direct = await new BankFolderRepository(folders.adb).directCounts();
    expect(direct[0]).toEqual({ folderId: 2, bankCount: 4, questionCount: 9 });
  });

  it('RETURNING id 是字符串时也返回 number（create 用 RETURNING，两库同句）', async () => {
    const g = stubAsyncDb('pg', { get: () => ({ id: '11' }) });
    expect(await new QuestionGroupRepository(g.adb).create('t', '', null)).toBe(11);

    const k = stubAsyncDb('pg', { get: () => ({ id: '12' }) });
    expect(await new KnowledgeRepository(k.adb).create({ lessonId: 1, title: 't', kind: 'text' })).toBe(12);

    const t = stubAsyncDb('pg', { get: () => ({ id: '13' }) });
    expect(await new TagRepository(t.adb).create({ name: 'x', note: '', createdBy: null })).toBe(13);

    const f = stubAsyncDb('pg', { get: () => ({ id: 14, parent_id: null, name: 'x', sort: 0 }) });
    expect((await new BankFolderRepository(f.adb).insert(null, 'x', 0)).id).toBe(14);
  });
});

describe('收尾批次：新方言片段按驱动生成', () => {
  it('#26 nowText / #6 nocase / #27 nullSafeEq / #28 insertionOrder', () => {
    expect(nowText('sqlite')).toBe("datetime('now')");
    expect(nowText('pg')).toContain('to_char(now() AT TIME ZONE');
    expect(nocase('t.name', 'sqlite')).toBe('t.name COLLATE NOCASE');
    expect(nocase('t.name', 'pg')).toBe('t.name');
    expect(nullSafeEq('parent_id', 'sqlite')).toBe('parent_id IS ?');
    expect(nullSafeEq('parent_id', 'pg')).toBe('parent_id IS NOT DISTINCT FROM ?');
    expect(insertionOrder('i', 'sqlite')).toBe('i.rowid');
    expect(insertionOrder('i', 'pg')).toBe('i.question_id');
  });

  it('#22 题目标签插入在两库都是 ON CONFLICT DO NOTHING；#19 台账时间戳按驱动生成', async () => {
    const tagSql = stubAsyncDb('sqlite');
    await new TagRepository(tagSql.adb).setQuestionTags(1, [2]);
    expect(tagSql.sqls.some((sql) => sql.includes('ON CONFLICT DO NOTHING'))).toBe(true);
    expect(tagSql.sqls.some((sql) => sql.includes('INSERT OR IGNORE'))).toBe(false);

    const sqliteNow = stubAsyncDb('sqlite');
    await new QuestionConflictRepository(sqliteNow.adb).upsertStatus('h', 'pending', '', { id: 1, name: 'x' });
    const sqliteStmt = sqliteNow.sqls.find((sql) => sql.includes('question_conflicts')) ?? '';
    expect(sqliteStmt).toContain('unixepoch()');

    const pgNow = stubAsyncDb('pg');
    await new QuestionConflictRepository(pgNow.adb).upsertStatus('h', 'pending', '', { id: 1, name: 'x' });
    const pgStmt = pgNow.sqls.find((sql) => sql.includes('question_conflicts')) ?? '';
    expect(pgStmt).toContain('EXTRACT(EPOCH FROM now())');
    expect(pgStmt).not.toContain('unixepoch()');
  });
});

describe('收尾批次：两条 PG 隐式行为（#29 别名大小写 / #30 upsert 自引用）', () => {
  it('#29 src 里不得出现未加引号的 camelCase SQL 别名（PG 会把裸别名全部小写）', () => {
    const bad: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // 注释不算
          const hit = /\bAS\s+([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/.exec(line);
          if (hit) bad.push(`${full}:${index + 1} → AS ${hit[1]}`);
        });
      }
    };
    walk('apps/api/src');
    expect(bad).toEqual([]);
  });

  it('#30 进度/错题本的 upsert 自引用列写全表名（PG 报 column reference ... is ambiguous）', async () => {
    const progressSql = stubAsyncDb('pg');
    await new ProgressRepository({} as unknown as Db, progressSql.adb).upsert({
      userId: 1,
      lessonId: 1,
      position: 1,
      duration: 2,
      finished: false,
    });
    expect(progressSql.sqls.join('\n')).toContain('lesson_progress.finished');

    const quizSql = stubAsyncDb('pg');
    await new ProgressRepository({} as unknown as Db, quizSql.adb).markQuizDone(1, 1, 60);
    expect(quizSql.sqls.join('\n')).toContain('lesson_progress.quiz_best');

    const wrongSql = stubAsyncDb('pg');
    await new AttemptRepository({} as unknown as Db, wrongSql.adb).recordSubmission(
      { userId: 1, clientId: 'u:1', lessonId: 1, answers: [], score: 0, total: 0 },
      [{ questionId: 1, wrong: true }],
    );
    expect(wrongSql.sqls.join('\n')).toContain('wrong_questions.wrong_count');
  });
});

describe('收尾批次：app.ts 的注入与路由 await（真 SQLite）', () => {
  let dataDir: string;
  let built: BuiltApp;
  let cookie = '';
  let courseId = 0;

  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    built.app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-final-async-'));
    const config = loadConfig({
      ...process.env,
      MC_ENV: 'test',
      MC_DATA_DIR: dataDir,
      MC_LOG_LEVEL: 'silent',
      MC_ADMIN_USER: 'admin',
      MC_ADMIN_PASS: 'admin123',
    });
    const db = new Db(':memory:');
    built = await buildApp(config, { db });
    await built.app.ready();
    const login = await built.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'admin123' },
    });
    const c = login.cookies.find((x) => x.name === 'microclass_sid');
    cookie = c ? `microclass_sid=${c.value}` : '';
    courseId = await built.deps.courses.create({ name: '收尾课程' });
    expect(getAsyncDb(config, db).driver).toBe('sqlite');
  });

  afterAll(async () => {
    await built.app.close();
    resetAsyncDbCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('app.ts 给 knowledge / conflicts 注入了 AsyncDb（不是同步 Db）', () => {
    const wiredKnowledge = built.deps.knowledge as unknown as { db?: { driver?: string } };
    expect(wiredKnowledge.db?.driver).toBe('sqlite');
    const wiredConflict = built.deps.conflictService as unknown as {
      conflicts?: { db?: { driver?: string } };
    };
    expect(wiredConflict.conflicts?.db?.driver).toBe('sqlite');
  });

  it('题组接口返回真实结构（漏 await 会变成 {}）', async () => {
    const created = await inject('POST', '/question-groups', { title: '收尾题组' });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;
    expect(typeof id).toBe('number');

    const list = await inject('GET', '/question-groups');
    const body = list.json<{ groups: { id: number; total: number; roleCounts: unknown }[] }>();
    expect(body.groups.find((g) => g.id === id)?.total).toBe(0);

    const detail = await inject('GET', `/question-groups/${id}`);
    expect(detail.json<{ title: string }>().title).toBe('收尾题组');
  });

  it('标签接口返回真实结构（列表带 questionCount 数字）', async () => {
    const created = await inject('POST', '/tags', { name: '收尾标签' });
    expect(created.statusCode).toBe(201);
    expect(typeof created.json<{ id: number }>().id).toBe('number');
    const list = await inject('GET', '/tags');
    const tags = list.json<{ tags: { questionCount: unknown }[] }>().tags;
    expect(tags.length).toBeGreaterThanOrEqual(1);
    expect(typeof tags[0]?.questionCount).toBe('number');
  });

  it('题库文件夹接口返回真实树（不是 Promise）', async () => {
    const created = await inject('POST', '/banks/folders', { name: '收尾目录' });
    expect(created.statusCode).toBe(201);
    const folder = created.json<{ folder: { id: number; name: string } }>().folder;
    expect(folder.name).toBe('收尾目录');

    const tree = await inject('GET', '/banks/folders');
    const body = tree.json<{ folders: { id: number }[]; unfiled: { bankCount: number } }>();
    expect(body.folders.some((f) => f.id === folder.id)).toBe(true);
    expect(typeof body.unfiled.bankCount).toBe('number');
  });

  it('冲突台账接口返回真实对象（list / sync 的 await 到位）', async () => {
    const list = await inject('GET', '/question-conflicts');
    const body = list.json<{ counts: { total: number }; items: unknown[] }>();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.counts.total).toBe('number');

    const sync = await inject('POST', '/question-conflicts/sync');
    const synced = sync.json<{ scannedGroups: number; ms: { total: number } }>();
    expect(typeof synced.scannedGroups).toBe('number');
    expect(typeof synced.ms.total).toBe('number');
  });

  it('课程详情里的 knowledge 是数组（漏 await 会变 {}）', async () => {
    await inject('POST', `/courses/${courseId}/knowledge`, { title: '课程级知识点', kind: 'text', content: '正文' });
    const detail = await inject('GET', `/courses/${courseId}`);
    const body = detail.json<{ knowledge: { title: string }[] }>();
    expect(Array.isArray(body.knowledge)).toBe(true);
    expect(body.knowledge[0]?.title).toBe('课程级知识点');
  });
});
