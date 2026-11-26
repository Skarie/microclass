/**
 * analytics 批次的 int8 收敛 + 真 SQLite 日期分组对照。
 *
 * - **方言 #17**：PG 的 int8 经 node-postgres 回传字符串，仓储边界必须收敛成 number；
 *   否则接口会返回 "7" 而不是 7，前端排序/求和会出错。
 * - **日期分组口径**：迁移只换实现不换语义——学习日历仍是服务器本地日，
 *   学情趋势仍是 UTC 日；这里用真 SQLite 跑同一批时间戳，与 JS 计算值对照。
 */
import { describe, expect, it, vi } from 'vitest';
import { createSqliteAsyncDb, type AsyncDb } from '../src/db/async.js';
import { Db } from '../src/db/client.js';
import { ActivityRepository } from '../src/db/repositories/activityRepository.js';
import { AnalyticsRepository } from '../src/db/repositories/analyticsRepository.js';

function stubDb(): { db: Db; all: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  const all = vi.fn(() => []);
  const get = vi.fn(() => undefined);
  return { db: { all, get, run: vi.fn() } as unknown as Db, all, get };
}

function stubAsyncDb(get: (sql: string) => unknown, all: (sql: string) => unknown[]): AsyncDb {
  const adb = {
    driver: 'sqlite' as const,
    all: vi.fn(async (sql: string) => all(sql)),
    get: vi.fn(async (sql: string) => get(sql)),
    run: vi.fn(async () => ({ changes: 0 })),
    transaction: vi.fn(async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(adb)),
    close: vi.fn(async () => undefined),
  } as unknown as AsyncDb;
  return adb;
}

describe('方言 #17：int8 字符串在仓储边界收敛成 number', () => {
  it('analytics 的计数 / 学员 id / 题目 id 全部是 number', async () => {
    const { db } = stubDb();
    const adb = stubAsyncDb(
      (sql) => {
        if (sql.includes('COUNT(*) AS graded')) return { graded: '7', wrong: '3', students: '2', questions: '5' };
        if (sql.includes('COUNT(DISTINCT q.point) AS points')) return { points: '4' };
        if (sql.includes('FROM attempts')) return { c: '6' };
        if (sql.includes('FROM exam_attempts')) return { c: '2' };
        if (sql.includes('LEFT JOIN banks b')) return { questions: '100', points: '9' };
        return { c: '12' };
      },
      (sql) => {
        if (sql.includes('GROUP BY q.point')) {
          return [{ point: 'P', graded: '7', wrong: '3', students: '2', questions: '5' }];
        }
        if (sql.includes('LEFT JOIN users')) {
          return [
            { user_id: '9', username: 'u', display_name: 'U', graded: '7', wrong: '3', questions: '5', points: '4' },
          ];
        }
        if (sql.includes('HAVING')) return [{ user_id: '9', point: 'P', wrong: '3' }];
        if (sql.includes('AS question_id')) {
          return [
            {
              question_id: '11',
              stem: 's',
              type: 'single',
              point: 'P',
              difficulty: 'easy',
              graded: '7',
              wrong: '3',
              students: '2',
            },
          ];
        }
        return [{ day: '2026-01-02', graded: '7', wrong: '3', students: '2' }];
      },
    );
    const repo = new AnalyticsRepository(db, adb);

    expect(await repo.totals({})).toEqual({
      graded: 7,
      wrong: 3,
      students: 2,
      questions: 5,
      points: 4,
      practiceAttempts: 6,
      examAttempts: 2,
    });
    expect(await repo.points({})).toMatchObject([{ graded: 7, wrong: 3, students: 2, questions: 5 }]);
    expect(await repo.students({})).toMatchObject([
      { user_id: 9, graded: 7, wrong: 3, questions: 5, points: 4, weakest_point: 'P', weakest_wrong: 3 },
    ]);
    expect(await repo.questions({})).toMatchObject([{ question_id: 11, graded: 7, wrong: 3, students: 2 }]);
    expect(await repo.trend({})).toMatchObject([{ day: '2026-01-02', graded: 7, wrong: 3, students: 2 }]);
    expect(await repo.studentAccounts()).toBe(12);
    expect(await repo.scopeSize({})).toEqual({ questions: 100, points: 9 });
  });
});

describe('SQLite 真库：日期分组与迁移前口径一致', () => {
  /** 服务器本地日期（与 activityRepository 的 localtime 口径一致） */
  const localDate = (ts: number): string => {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const utcDate = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);

  function createDb(): Db {
    const db = new Db(':memory:');
    db.run('CREATE TABLE lessons (id INTEGER PRIMARY KEY, course_id INTEGER)');
    db.run('CREATE TABLE exams (id INTEGER PRIMARY KEY, course_id INTEGER)');
    db.run('CREATE TABLE banks (id INTEGER PRIMARY KEY, course_id INTEGER, lesson_id INTEGER)');
    db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, role TEXT)');
    db.run(
      'CREATE TABLE questions (id INTEGER PRIMARY KEY, bank_id INTEGER, lesson_id INTEGER, stem TEXT, type TEXT, point TEXT, difficulty TEXT)',
    );
    db.run(
      "CREATE TABLE attempts (id INTEGER PRIMARY KEY, client_id TEXT, user_id INTEGER, lesson_id INTEGER, answers TEXT DEFAULT '[]', score INTEGER DEFAULT 0, total INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()))",
    );
    db.run(
      "CREATE TABLE exam_attempts (id INTEGER PRIMARY KEY, exam_id INTEGER, user_id INTEGER, answers TEXT DEFAULT '[]', score INTEGER DEFAULT 0, total INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()))",
    );
    db.run(
      'CREATE TABLE lesson_progress (user_id INTEGER, lesson_id INTEGER, position INTEGER, duration INTEGER, updated_at INTEGER)',
    );
    return db;
  }

  it('activity 的本地日与 analytics 的 UTC 日都按同一批时间戳正确分桶', async () => {
    const db = createDb();
    try {
      // 本地 2026-01-15 00:00 前后各 1 秒（跨日边界）
      const localMidnight = Math.floor(new Date(2026, 0, 15, 0, 0, 0).getTime() / 1000);
      const insertAttempt = (createdAt: number, correct: boolean | null): void => {
        db.run("INSERT INTO attempts (client_id, user_id, lesson_id, answers, created_at) VALUES ('a',?,?,?,?)", [
          1,
          2,
          JSON.stringify([{ qid: 1, answer: 'x', correct }]),
          createdAt,
        ]);
      };
      insertAttempt(localMidnight + 1, false);
      insertAttempt(localMidnight + 2, null);
      db.run('INSERT INTO lesson_progress (user_id, lesson_id, position, duration, updated_at) VALUES (?,?,0,0,?)', [
        1,
        2,
        localMidnight - 1,
      ]);
      db.run('INSERT INTO lesson_progress (user_id, lesson_id, position, duration, updated_at) VALUES (?,?,0,0,?)', [
        1,
        3,
        localMidnight + 1,
      ]);
      db.run('INSERT INTO users (id, role) VALUES (1, ?)', ['student']);
      db.run("INSERT INTO questions (id, stem, type, point, difficulty) VALUES (1,'s','single','P','easy')");

      const adb = createSqliteAsyncDb(db);
      const activity = new ActivityRepository(db, adb);
      const analytics = new AnalyticsRepository(db, adb);

      const days = await activity.daily(1, localMidnight - 10 * 86400);
      expect(days).toEqual([
        { date: localDate(localMidnight - 1), lessons: 1, quizzes: 0 },
        { date: localDate(localMidnight + 1), lessons: 1, quizzes: 2 },
      ]);

      // analytics trend 是 UTC 日：换成 UTC 午夜边界，验证口径没被「顺手改成 localtime」
      const utcMidnight = Date.UTC(2026, 0, 15, 0, 0, 0) / 1000;
      db.run('DELETE FROM attempts');
      insertAttempt(utcMidnight - 1, false);
      insertAttempt(utcMidnight + 1, true);
      insertAttempt(utcMidnight + 2, null); // 主观题：必须被 `IN (1,0)` 排除
      const trend = await analytics.trend({});
      expect(trend.map((t) => t.day)).toEqual([utcDate(utcMidnight - 1), utcDate(utcMidnight + 1)]);
      expect(trend).toEqual([
        { day: '2026-01-14', graded: 1, wrong: 1, students: 1 },
        { day: '2026-01-15', graded: 1, wrong: 0, students: 1 },
      ]);

      const totals = await analytics.totals({});
      expect(totals).toMatchObject({ graded: 2, wrong: 1, students: 1, questions: 1, practiceAttempts: 3 });
      expect(typeof totals.graded).toBe('number');
    } finally {
      db.close();
    }
  });
});
