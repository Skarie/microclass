/**
 * progress / notes / watch 域写方法的事务与异步语义（P0 阶段 2）。
 *
 * 三个仓储从同步 `Db` 迁到 `AsyncDb`：
 *   - `ProgressRepository.upsert` / `markQuizDone`：高频写（播放器每十几秒一次），单语句 upsert；
 *   - `WatchIntervalRepository.record`：多语句写（先删后插），必须整体事务，中途失败要整批回滚，
 *     否则会把学生「已看片段」删掉；
 *   - `NoteRepository.create`：改 `INSERT … RETURNING id`。
 *
 * 本文件默认只跑 sqlite（内存库）；PG 分支需要 `MC_PG_TEST_URL`（按硬规则不在生产机器上跑）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import { NoteRepository } from '../src/db/repositories/noteRepository.js';
import { ProgressRepository } from '../src/db/repositories/progressRepository.js';
import { WatchIntervalRepository } from '../src/db/repositories/watchIntervalRepository.js';
import type { AsyncDb } from '../src/db/async.js';

let dataDir: string;
let built: BuiltApp;
let app: FastifyInstance;
let db: Db;
let asyncDb: AsyncDb;
let progress: ProgressRepository;
let intervals: WatchIntervalRepository;
let notes: NoteRepository;

const USER_ID = 201;
const LESSON_ID = 1;

function json<T>(res: { json: () => unknown }): T {
  return res.json() as T;
}

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  const c = res.cookies.find((x) => x.name === 'microclass_sid');
  return c ? `microclass_sid=${c.value}` : '';
}

async function dropTrigger(name: string): Promise<void> {
  await asyncDb.run(`DROP TRIGGER IF EXISTS ${name}`);
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-progress-tx-'));
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
  app = built.app;
  await app.ready();
  asyncDb = getAsyncDb(config, db);
  progress = new ProgressRepository(db, asyncDb);
  intervals = new WatchIntervalRepository(db, asyncDb);
  notes = new NoteRepository(db, asyncDb);
  // 一个本地视频课时（进度/区间/笔记都挂在它上面）
  await asyncDb.run(
    `INSERT INTO lessons (id, title, video_kind, media_root, video_path, duration)
     VALUES (?,?,?,?,?,?)`,
    [LESSON_ID, '进度事务用例课时', 'local', 'root-a', 'tx.mp4', 1080],
  );
  await asyncDb.run('INSERT INTO users (id, username, pass_salt, pass_hash, role) VALUES (?,?,?,?,?)', [
    USER_ID,
    'tx-student',
    's',
    'h',
    'student',
  ]);
});

afterAll(async () => {
  await app.close();
  resetAsyncDbCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('WatchIntervalRepository：先删后插必须整批回滚', () => {
  it('record 中途失败 → 原有已看片段不被删掉（整批回滚）', async () => {
    await intervals.record(USER_ID, LESSON_ID, [{ start: 0, end: 120 }]);
    expect(await intervals.covered(USER_ID, LESSON_ID)).toBe(120);

    // 让「插入新片段」这一步必然失败，验证前面的 DELETE 也被回滚
    await asyncDb.run(
      "CREATE TRIGGER tx_fail_watch_insert BEFORE INSERT ON watch_intervals BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      await expect(intervals.record(USER_ID, LESSON_ID, [{ start: 200, end: 300 }])).rejects.toThrow();
      // 关键断言：旧片段仍在，没有被 DELETE 掉
      expect(await intervals.covered(USER_ID, LESSON_ID)).toBe(120);
      expect(await intervals.list(USER_ID, LESSON_ID)).toHaveLength(1);
    } finally {
      await dropTrigger('tx_fail_watch_insert');
    }

    // 去掉故障后继续上报：并集累加正常
    await intervals.record(USER_ID, LESSON_ID, [{ start: 200, end: 300 }]);
    expect(await intervals.covered(USER_ID, LESSON_ID)).toBe(220);
  });

  it('clear 清空后 covered 归零', async () => {
    await intervals.record(USER_ID, LESSON_ID, [{ start: 0, end: 60 }]);
    await intervals.clear(USER_ID, LESSON_ID);
    expect(await intervals.covered(USER_ID, LESSON_ID)).toBe(0);
    expect(await intervals.list(USER_ID, LESSON_ID)).toEqual([]);
  });
});

describe('ProgressRepository：高频 upsert 与聚合', () => {
  it('upsert 后能读回；finished 只增不减（MAX 语义）', async () => {
    await progress.upsert({ userId: USER_ID, lessonId: LESSON_ID, position: 300, duration: 1000, finished: true });
    const first = await progress.get(USER_ID, LESSON_ID);
    expect(first?.finished).toBe(1);
    expect(first?.position).toBe(1000); // finished 时位置按整段时长记

    // 再报一次「没看完」的小位置：finished 不能被改回 0
    await progress.upsert({ userId: USER_ID, lessonId: LESSON_ID, position: 10, duration: 1000, finished: false });
    const second = await progress.get(USER_ID, LESSON_ID);
    expect(second?.finished).toBe(1);
    expect(second?.position).toBe(10);
  });

  it('markQuizDone 记最佳成绩；listByUser / summary 走异步端口', async () => {
    await progress.markQuizDone(USER_ID, LESSON_ID, 60);
    await progress.markQuizDone(USER_ID, LESSON_ID, 40); // 更低的分数不覆盖
    const row = await progress.get(USER_ID, LESSON_ID);
    expect(row?.quiz_done).toBe(1);
    expect(row?.quiz_best).toBe(60);

    const list = await progress.listByUser(USER_ID);
    expect(list.length).toBeGreaterThanOrEqual(1);

    const summary = await progress.summary(USER_ID);
    expect(summary.finishedLessons).toBeGreaterThanOrEqual(1);
    expect(summary.quizzed).toBeGreaterThanOrEqual(1);
    expect(typeof summary.minutes).toBe('number');
    expect(typeof summary.level).toBe('string');
  });

  it('deleteForUser 清掉该用户全部进度（管理员删账号用）', async () => {
    await progress.upsert({ userId: 999, lessonId: LESSON_ID, position: 5, duration: 10, finished: false });
    expect((await progress.listByUser(999)).length).toBe(1);
    const changes = await progress.deleteForUser(999);
    expect(changes).toBe(1);
    expect(await progress.listByUser(999)).toEqual([]);
  });
});

describe('NoteRepository：RETURNING id 与按本人过滤', () => {
  it('create 返回数字 id，list/find/delete 生效', async () => {
    const id = await notes.create({ userId: USER_ID, lessonId: LESSON_ID, pos: 12.5, text: '第一条笔记' });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);

    const rows = await notes.listByLesson(USER_ID, LESSON_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('第一条笔记');
    expect(await notes.countByLesson(USER_ID, LESSON_ID)).toBe(1);
    expect((await notes.findById(id, USER_ID))?.text).toBe('第一条笔记');
    // 别人的笔记读不到
    expect(await notes.findById(id, USER_ID + 1)).toBeUndefined();

    await notes.delete(id, USER_ID);
    expect(await notes.countByLesson(USER_ID, LESSON_ID)).toBe(0);
  });
});

describe('路由层：进度/区间/笔记接口的 await 是否到位', () => {
  it('POST /progress/intervals 返回真实数值（漏 await 会变成 {}）', async () => {
    const cookie = await login('admin', 'admin123');
    expect(cookie).not.toBe('');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/progress/intervals',
      headers: { cookie },
      payload: { lessonId: LESSON_ID, position: 100, duration: 1080, intervals: [{ start: 0, end: 100 }] },
    });
    expect(res.statusCode).toBe(200);
    const body = json<{ ok: boolean; coveredSeconds: number; duration: number; percent: number }>(res);
    expect(body.ok).toBe(true);
    expect(typeof body.coveredSeconds).toBe('number');
    expect(body.coveredSeconds).toBe(100);
    expect(typeof body.percent).toBe('number');
  });

  it('GET /progress、GET /me/summary、笔记的增删查都返回对象而不是 Promise', async () => {
    const cookie = await login('admin', 'admin123');

    const list = await app.inject({ method: 'GET', url: '/api/v1/progress', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(json<{ progress: unknown[] }>(list).progress)).toBe(true);

    const summary = await app.inject({ method: 'GET', url: '/api/v1/me/summary', headers: { cookie } });
    expect(summary.statusCode).toBe(200);
    expect(typeof json<{ minutes: number }>(summary).minutes).toBe('number');

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/lessons/${LESSON_ID}/notes`,
      headers: { cookie },
      payload: { pos: 3, text: '路由层笔记' },
    });
    expect(created.statusCode).toBe(200);
    const noteId = json<{ id: number }>(created).id;
    expect(typeof noteId).toBe('number');

    const fetched = await app.inject({ method: 'GET', url: `/api/v1/lessons/${LESSON_ID}/notes`, headers: { cookie } });
    expect(fetched.statusCode).toBe(200);
    expect(json<{ count: number }>(fetched).count).toBeGreaterThanOrEqual(1);

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId}`, headers: { cookie } });
    expect(removed.statusCode).toBe(200);
    // 删完再删 → 404（说明 remove 真的是先查后删，不是把 Promise 当 note）
    const again = await app.inject({ method: 'DELETE', url: `/api/v1/notes/${noteId}`, headers: { cookie } });
    expect(again.statusCode).toBe(404);
  });

  it('删学生账号会连带清掉他的进度行（走 progress 仓储）', async () => {
    const cookie = await login('admin', 'admin123');
    // 建一个学生并给他造进度
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie },
      payload: { username: 'delprog1', password: 'stud12345', role: 'student' },
    });
    expect(created.statusCode).toBe(200);
    const studentId = json<{ id: number }>(created).id;
    await progress.upsert({ userId: studentId, lessonId: LESSON_ID, position: 7, duration: 100, finished: false });
    expect((await progress.listByUser(studentId)).length).toBe(1);

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/users/${studentId}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(await progress.listByUser(studentId)).toEqual([]);
  });
});
