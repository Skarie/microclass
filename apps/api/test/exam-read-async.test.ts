/**
 * exams 只读迁移（批次 1）的契约测试：**读走 AsyncDb、写仍走同步 Db**。
 *
 * 为什么单独钉：
 *   - `tsc` 抓不到「读方法忘了走 asyncDb」——漏了在 sqlite 下照样能跑，
 *     但 PG 模式下会变成「读 SQLite、写 PG」的跨库混合路径（切流前必须清零）；
 *   - 反过来也不能把写方法顺手迁进本批次：组卷/交卷的事务边界是批次 2 的事，
 *     本批次只允许读方法碰 AsyncDb。
 *   - PG 的 COUNT 是 int8，node-postgres 默认回传**字符串**（方言 #17），
 *     读方法的计数必须在仓储边界收敛成 number，否则 API 会返回 "3" 而不是 3。
 */
import { describe, expect, it, vi } from 'vitest';
import type { AsyncDb } from '../src/db/async.js';
import type { Db } from '../src/db/client.js';
import { ExamRepository } from '../src/db/repositories/examRepository.js';

/** 同步 Db 桩：只给写方法用，任何写路径都不该碰 AsyncDb */
function stubDb(): {
  db: Db;
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(() => ({ changes: 1, lastInsertRowid: 42 }));
  const get = vi.fn(() => undefined);
  const all = vi.fn(() => []);
  const transaction = vi.fn((fn: () => unknown) => fn());
  return { db: { run, get, all, transaction } as unknown as Db, run, get, transaction };
}

/** 异步端口桩：记录调用，返回值可按 SQL 定制 */
function stubAsyncDb(handlers: { all?: (sql: string) => unknown[]; get?: (sql: string) => unknown } = {}): {
  adb: AsyncDb;
  all: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
} {
  const all = vi.fn(async (sql: string) => handlers.all?.(sql) ?? []);
  const get = vi.fn(async (sql: string) => handlers.get?.(sql));
  const run = vi.fn(async () => ({ changes: 0 }));
  const adb = {
    driver: 'sqlite' as const,
    all,
    get,
    run,
    transaction: vi.fn(async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(adb)),
    close: vi.fn(async () => undefined),
  } as unknown as AsyncDb;
  return { adb, all, get, run };
}

const examRow = {
  id: 5,
  course_id: 3,
  title: '只读迁移考试',
  description: '',
  duration_minutes: 60,
  pass_score: 60,
  status: 'published',
  structure: '[]',
  difficulty_target: '',
  total_score: 100,
  start_at: 0,
  end_at: 0,
  attempt_limit: 0,
  shuffle_questions: 0,
  show_answers: 1,
};

describe('exams 批次 1：读方法全部走 AsyncDb', () => {
  const readCases: { name: string; call: (repo: ExamRepository) => Promise<unknown> }[] = [
    { name: 'listByCourse', call: (r) => r.listByCourse(3) },
    { name: 'listByCourseWithStats', call: (r) => r.listByCourseWithStats(3, null) },
    { name: 'findById', call: (r) => r.findById(5) },
    { name: 'listQuestions', call: (r) => r.listQuestions(5) },
    { name: 'questionInExam', call: (r) => r.questionInExam(5, 7) },
    { name: 'questionIds', call: (r) => r.questionIds(5) },
    { name: 'pick', call: (r) => r.pick({ type: 'single' }) },
    { name: 'pickIds', call: (r) => r.pickIds({ type: 'single' }) },
    { name: 'pickCount', call: (r) => r.pickCount({ type: 'single' }) },
    { name: 'pool', call: (r) => r.pool(3) },
    { name: 'search', call: (r) => r.search({}) },
    { name: 'taxonomy', call: (r) => r.taxonomy({}) },
    { name: 'facets', call: (r) => r.facets({}) },
    { name: 'pointsOf', call: (r) => r.pointsOf({}) },
    { name: 'pointStats', call: (r) => r.pointStats({}) },
    { name: 'attemptCount', call: (r) => r.attemptCount(5, 9) },
    { name: 'findAttempt', call: (r) => r.findAttempt(5, 9) },
    { name: 'attemptsOf', call: (r) => r.attemptsOf(5) },
    { name: 'attemptsByUser', call: (r) => r.attemptsByUser(9) },
  ];

  for (const { name, call } of readCases) {
    it(`${name}() 返回 Promise，且只经 AsyncDb 取数`, async () => {
      const { db } = stubDb();
      const { adb, all, get, run } = stubAsyncDb();
      const repo = new ExamRepository(db, adb);

      const pending = call(repo);
      expect(pending).toBeInstanceOf(Promise);
      await pending;

      expect(all.mock.calls.length + get.mock.calls.length + run.mock.calls.length).toBeGreaterThan(0);
    });
  }

  it('读方法的 PG int8 字符串计数会收敛成 number（方言 #17）', async () => {
    const { db } = stubDb();
    const { adb } = stubAsyncDb({
      all: (sql) => (sql.includes('FROM exams WHERE course_id = ?') ? [examRow] : []),
      // COUNT(*) / SUM(...) 在 PG 里是 int8 → node-postgres 回传字符串
      get: (sql) => (sql.includes('COUNT(*)') ? { c: '3' } : { id: 9 }),
    });
    const repo = new ExamRepository(db, adb);

    const list = await repo.listByCourseWithStats(3, 9);
    expect(list).toHaveLength(1);
    expect(list[0]?.question_count).toBe(3);
    expect(list[0]?.attempt_count).toBe(3);
    expect(list[0]?.my).toEqual({ id: 9 });

    expect(await repo.attemptCount(5, 9)).toBe(3);
    expect(await repo.pickCount({})).toBe(3);
  });
});

describe('exams 批次 1：写方法没有混入 AsyncDb（批次 2 才迁）', () => {
  it('create / update / setStructure / addQuestions / createAttempt 仍走同步 Db', () => {
    const { db, run } = stubDb();
    const { adb, all, get, run: asyncRun } = stubAsyncDb();
    const repo = new ExamRepository(db, adb);

    expect(repo.create({ courseId: 3, title: '写路径考试' })).toBe(42);
    repo.update(5, { courseId: 3, title: '改标题' });
    repo.setStructure(5, '[]');
    expect(repo.addQuestions(5, [7, 8])).toBe(0);
    expect(
      repo.createAttempt({
        examId: 5,
        userId: 9,
        answers: [],
        score: 0,
        total: 0,
        passed: false,
        usedSeconds: 1,
      }),
    ).toBe(42);

    expect(run).toHaveBeenCalled();
    // 写路径不得触碰异步端口：一旦碰了，就是跨库混合读写
    expect(all).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(asyncRun).not.toHaveBeenCalled();
  });
});
