/**
 * analytics / stats / activity 批次（只读聚合）的契约测试。
 *
 * 钉住三件事：
 *   1. **只经 AsyncDb**：所有读方法返回 Promise，且不再碰同步 `Db`
 *      （PG 模式下漏掉就是「读 SQLite、写 PG」的跨库混合路径，`tsc` 不报错）；
 *   2. **方言 #21**：学习日历的本地日 / 学情趋势的 UTC 日，SQLite 与 PG 各自生成正确表达式；
 *   3. **方言 #24（JSON 展开）**：`json_each` ↔ `jsonb_array_elements`，主观题 `correct:null` 仍被排除。
 *
 * int8 收敛与真 SQLite 日期分组的对照见 `analytics-date-parity.test.ts`。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AsyncDb } from '../src/db/async.js';
import type { Db } from '../src/db/client.js';
import { ActivityRepository } from '../src/db/repositories/activityRepository.js';
import { AnalyticsRepository } from '../src/db/repositories/analyticsRepository.js';
import { StatsRepository } from '../src/db/repositories/noteRepository.js';
import { jsonArrayJoin, jsonBoolIntField, jsonIntField, unixDay } from '../src/db/sql.js';

type Driver = 'sqlite' | 'pg';

interface StubDb {
  db: Db;
  all: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

/** 同步 Db 桩：迁移完成后任何方法都不该再走它 */
function stubDb(): StubDb {
  const all = vi.fn(() => []);
  const get = vi.fn(() => undefined);
  const run = vi.fn(() => ({ changes: 1 }));
  return { db: { all, get, run } as unknown as Db, all, get, run };
}

interface StubHandlers {
  driver?: Driver;
  all?: (sql: string) => unknown[];
  get?: (sql: string) => unknown;
}

interface StubAsyncDb {
  adb: AsyncDb;
  sqls: string[];
  all: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

/** 异步端口桩：记录所有 SQL，返回值可按 SQL 定制 */
function stubAsyncDb(handlers: StubHandlers = {}): StubAsyncDb {
  const sqls: string[] = [];
  const all = vi.fn(async (sql: string) => {
    sqls.push(sql);
    return handlers.all?.(sql) ?? [];
  });
  const get = vi.fn(async (sql: string) => {
    sqls.push(sql);
    return handlers.get?.(sql);
  });
  const run = vi.fn(async () => ({ changes: 0 }));
  const adb = {
    driver: handlers.driver ?? 'sqlite',
    all,
    get,
    run,
    transaction: vi.fn(async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(adb)),
    close: vi.fn(async () => undefined),
  } as unknown as AsyncDb;
  return { adb, sqls, all, get, run };
}

const analyticsReads: { name: string; call: (repo: AnalyticsRepository) => Promise<unknown> }[] = [
  { name: 'totals', call: (r) => r.totals({}) },
  { name: 'points', call: (r) => r.points({}) },
  { name: 'students', call: (r) => r.students({}) },
  { name: 'questions', call: (r) => r.questions({}) },
  { name: 'trend', call: (r) => r.trend({}) },
  { name: 'studentAccounts', call: (r) => r.studentAccounts() },
  { name: 'scopeSize', call: (r) => r.scopeSize({}) },
];

describe('analytics：所有读方法只经 AsyncDb', () => {
  for (const { name, call } of analyticsReads) {
    it(`${name}() 返回 Promise 且不碰同步 Db`, async () => {
      const { db, all: syncAll, get: syncGet, run: syncRun } = stubDb();
      const { adb, all, get, run } = stubAsyncDb();
      const repo = new AnalyticsRepository(db, adb);

      const pending = call(repo);
      expect(pending).toBeInstanceOf(Promise);
      await pending;

      expect(all.mock.calls.length + get.mock.calls.length + run.mock.calls.length).toBeGreaterThan(0);
      expect(syncAll).not.toHaveBeenCalled();
      expect(syncGet).not.toHaveBeenCalled();
      expect(syncRun).not.toHaveBeenCalled();
    });
  }
});

describe('activity / stats：读方法只经 AsyncDb', () => {
  it('ActivityRepository 三个方法都返回 Promise，且 daily() 真的 await 两次查询', async () => {
    const { db, all: syncAll, get: syncGet } = stubDb();
    const { adb, all } = stubAsyncDb();
    const repo = new ActivityRepository(db, adb);

    for (const pending of [repo.lessonDays(1, 0), repo.quizDays(1, 0), repo.daily(1, 0)]) {
      expect(pending).toBeInstanceOf(Promise);
      await pending;
    }
    expect(all).toHaveBeenCalledTimes(4); // lessonDays + quizDays + daily 内部各两次
    expect(syncAll).not.toHaveBeenCalled();
    expect(syncGet).not.toHaveBeenCalled();
  });

  it('StatsRepository students/lessonRows 返回 Promise，lessonSummary 仍是纯函数', async () => {
    const { db, all: syncAll, get: syncGet } = stubDb();
    const { adb } = stubAsyncDb({
      all: (sql) => (sql.includes('FROM users') ? [{ id: '9', username: 's', display_name: '学生' }] : []),
      get: (sql) =>
        sql.includes('FROM lesson_progress')
          ? { position: '10', duration: '100', finished: '1', quiz_done: '1', updated_at: '1700000000' }
          : { m: '88', c: '2' },
    });
    const repo = new StatsRepository(db, adb);

    const students = repo.students();
    expect(students).toBeInstanceOf(Promise);
    expect(await students).toEqual([{ id: 9, username: 's', display_name: '学生' }]);

    const rows = repo.lessonRows(3);
    expect(rows).toBeInstanceOf(Promise);
    const list = await rows;
    expect(list).toEqual([
      {
        id: 9,
        username: 's',
        display_name: '学生',
        watched: true,
        finished: true,
        percent: 10,
        quiz_done: true,
        best_score: 88,
        attempts: 2,
        updated_at: 1700000000,
      },
    ]);
    expect(repo.lessonSummary(list)).toMatchObject({ students: 1, watched: 1, finished: 1, quizzed: 1, best: 88 });
    expect(syncAll).not.toHaveBeenCalled();
    expect(syncGet).not.toHaveBeenCalled();
  });
});

describe('方言 #21：按日表达式', () => {
  it('SQLite 保持原修饰符语法（日历 localtime / 趋势 UTC）', () => {
    expect(unixDay('updated_at', 'sqlite', { local: true })).toBe("date(updated_at, 'unixepoch', 'localtime')");
    expect(unixDay('g.created_at', 'sqlite')).toBe("date(g.created_at, 'unixepoch')");
  });

  it('PG 用 to_char + AT TIME ZONE（日历 Asia/Shanghai / 趋势 UTC）', () => {
    expect(unixDay('updated_at', 'pg', { local: true })).toBe(
      "to_char(to_timestamp(updated_at) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')",
    );
    expect(unixDay('g.created_at', 'pg')).toBe("to_char(to_timestamp(g.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD')");
  });

  it('仓储在 pg 驱动下生成的 SQL 不含 SQLite 日期修饰符', async () => {
    const { db } = stubDb();
    const { adb, sqls } = stubAsyncDb({ driver: 'pg' });
    const analytics = new AnalyticsRepository(db, adb);
    const activity = new ActivityRepository(db, adb);

    await analytics.trend({});
    await activity.daily(1, 0);

    const trendSql = sqls.find((sql) => sql.includes('AS day') && sql.includes('graded'));
    expect(trendSql).toContain("to_char(to_timestamp(g.created_at) AT TIME ZONE 'UTC','YYYY-MM-DD')");
    for (const sql of sqls) expect(sql).not.toContain("'unixepoch'");
    expect(sqls.some((sql) => sql.includes("AT TIME ZONE 'Asia/Shanghai'"))).toBe(true);
  });
});

describe('方言 #24：JSON 数组展开（练习 + 考试作答）', () => {
  it('SQLite 用 json_each / json_extract，PG 用 jsonb_array_elements / ->>', () => {
    expect(jsonArrayJoin('a.answers', 'je', 'sqlite')).toBe(', json_each(a.answers) je');
    expect(jsonArrayJoin('a.answers', 'je', 'pg')).toBe(
      'CROSS JOIN LATERAL jsonb_array_elements(a.answers::jsonb) AS je(value)',
    );
    expect(jsonIntField('je', 'qid', 'sqlite')).toBe("CAST(json_extract(je.value, '$.qid') AS INTEGER)");
    expect(jsonIntField('je', 'qid', 'pg')).toBe("CAST(je.value->>'qid' AS INTEGER)");
    expect(jsonBoolIntField('je', 'correct', 'sqlite')).toBe("json_extract(je.value, '$.correct')");
    expect(jsonBoolIntField('je', 'correct', 'pg')).toContain("->>'correct' = 'true'");
  });

  it('PG 模式下生成的 analytics SQL 不再出现 SQLite 专有 JSON 函数', async () => {
    const { db } = stubDb();
    const { adb, sqls } = stubAsyncDb({ driver: 'pg' });
    const repo = new AnalyticsRepository(db, adb);

    for (const { call } of analyticsReads) await call(repo);

    const withJson = sqls.filter((sql) => sql.includes('answers'));
    expect(withJson.length).toBeGreaterThan(0);
    for (const sql of sqls) {
      expect(sql).not.toContain('json_each');
      expect(sql).not.toContain('json_extract');
    }
    for (const sql of withJson) {
      expect(sql).toContain('jsonb_array_elements');
      expect(sql).toContain("->>'qid'");
      // 主观题（correct=null）必须仍被排除
      expect(sql).toContain('IN (1, 0)');
    }
  });
});
