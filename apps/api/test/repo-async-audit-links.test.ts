/**
 * 最后 3 处同步仓储迁 `AsyncDb` 的契约（`auditRepository` / `practiceLinkQueries` / `bankHealthCacheRepository`）。
 *
 * 钉住四件事：
 *   1. 方法都返回 Promise，且**只经 AsyncDb**（PG 模式下同步 `Db` 不能再用：审计/练习链接/体检缓存
 *      写进 SQLite 就等于「业务在 PG、数据在历史归档」）；
 *   2. 方言片段按驱动生成（#22 `ON CONFLICT DO NOTHING`、#27 `IS NOT DISTINCT FROM`、#14 `RETURNING id`）；
 *   3. `bankHealthCache.checkpoint()` 在 PG 模式是空操作（`PRAGMA` 是 SQLite 专有）；
 *   4. 装配层真的注入了 asyncDb（漏注入会退回 `createSqliteAsyncDb(db)`，PG 模式静默写错库）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { Db } from '../src/db/client.js';
import { createSqliteAsyncDb, type AsyncDb, type DbDriverName } from '../src/db/async.js';
import { AuditRepository } from '../src/db/repositories/auditRepository.js';
import { PracticeLinkRepository } from '../src/db/repositories/practiceLinkQueries.js';
import { BankHealthCacheRepository } from '../src/db/repositories/bankHealthCacheRepository.js';
import { BankHealthCoordinator } from '../src/services/bankHealthCoordinator.js';
import type { BankHealthPayload } from '../src/db/repositories/bankHealthPayload.js';
import { nullSafeEq } from '../src/db/sql.js';

/** 异步端口桩：记录 SQL；`get` 可定制返回值 */
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

/** 同步 Db 桩：任何调用都抛错，用来证明「一次都没碰同步 Db」 */
function deadlyDb(): Db {
  const boom = (): never => {
    throw new Error('同步 Db 被触碰（PG 模式应为 0 次）');
  };
  return { get: boom, all: boom, run: boom, transaction: boom, checkpoint: boom } as unknown as Db;
}

const auditInput = { actorId: 7, actorName: 'admin', action: 'test.action', targetType: 'x', targetId: 1 };

describe('auditRepository 只经 AsyncDb', () => {
  it('write/flush/recent 都返回 Promise 且不碰同步 Db', async () => {
    const { adb, sqls } = stubAsyncDb();
    const repo = new AuditRepository(deadlyDb(), adb);
    await expect(repo.write(auditInput)).resolves.toBeUndefined();
    await expect(repo.flush()).resolves.toBeUndefined();
    await expect(repo.recent(5)).resolves.toEqual([]);
    expect(sqls.some((sql) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('ORDER BY id DESC LIMIT ?'))).toBe(true);
  });

  it('writeBuffered 攒批后 flush 用事务一次提交（审计失败不影响主流程）', async () => {
    const { adb, sqls } = stubAsyncDb('pg');
    const repo = new AuditRepository(deadlyDb(), adb);
    repo.writeBuffered(auditInput);
    repo.writeBuffered({ ...auditInput, action: 'test.action2' });
    await repo.flush();
    expect(sqls.filter((sql) => sql.includes('INSERT INTO audit_logs'))).toHaveLength(2);
    // 缓冲已清空：再 flush 不重复写
    await repo.flush();
    expect(sqls.filter((sql) => sql.includes('INSERT INTO audit_logs'))).toHaveLength(2);
  });

  it('事务内失败被吞掉（审计允许丢，但主流程不能 500）', async () => {
    const adb = {
      driver: 'sqlite',
      all: async () => [],
      get: async () => undefined,
      run: async () => {
        throw new Error('db down');
      },
      transaction: async () => {
        throw new Error('db down');
      },
      close: async () => undefined,
    } as unknown as AsyncDb;
    const repo = new AuditRepository(deadlyDb(), adb);
    repo.writeBuffered(auditInput);
    await expect(repo.flush()).resolves.toBeUndefined();
  });
});

describe('practiceLinkQueries 只经 AsyncDb + 方言', () => {
  const cases: { name: string; call: (repo: PracticeLinkRepository) => Promise<unknown> }[] = [
    { name: 'findById', call: (r) => r.findById(1) },
    { name: 'listByBank', call: (r) => r.listByBank(1) },
    { name: 'listByLesson', call: (r) => r.listByLesson(1) },
    {
      name: 'findByTarget',
      call: (r) => r.findByTarget({ targetType: 'bank', bankId: 1, questionId: null, chapter: '', section: '' }),
    },
    {
      name: 'insert',
      call: (r) => r.insert({ targetType: 'bank', bankId: 1, questionId: null, chapter: '', section: '' }),
    },
    { name: 'setLessonIds', call: (r) => r.setLessonIds(1, [2]) },
    { name: 'addLessonIds', call: (r) => r.addLessonIds(1, [2]) },
    { name: 'delete', call: (r) => r.delete(1) },
    { name: 'lessonsFor', call: (r) => r.lessonsFor([1]) },
    { name: 'questionsFor', call: (r) => r.questionsFor([1]) },
  ];

  it('10 个方法都返回 Promise（sqlite 驱动）', async () => {
    const { adb } = stubAsyncDb('sqlite', {
      get: (sql) => (sql.includes('RETURNING id') ? { id: 1 } : { id: 1, target_type: 'bank', bank_id: 1 }),
    });
    const repo = new PracticeLinkRepository(deadlyDb(), adb);
    for (const item of cases) {
      const result = item.call(repo);
      expect(result, item.name).toBeInstanceOf(Promise);
      await result;
    }
  });

  it('原生 SQL：IS ? / ON CONFLICT / RETURNING id（sqlite 侧文本不变）', async () => {
    const { adb, sqls } = stubAsyncDb('sqlite', { get: () => ({ id: 3, bank_id: 1, question_id: null }) });
    const repo = new PracticeLinkRepository(deadlyDb(), adb);
    await repo.findByTarget({ targetType: 'bank', bankId: 1, questionId: null, chapter: '', section: '' });
    await repo.insert({ targetType: 'bank', bankId: 1, questionId: null, chapter: '', section: '' });
    await repo.addLessonIds(1, [2]);
    expect(sqls[0]).toContain(nullSafeEq('question_id', 'sqlite'));
    expect(sqls[0]).toContain('question_id IS ?');
    expect(sqls.some((sql) => sql.includes('INSERT INTO practice_links') && sql.includes('RETURNING id'))).toBe(true);
    expect(
      sqls.some(
        (sql) =>
          sql.includes('INSERT INTO practice_link_lessons') &&
          sql.includes('ON CONFLICT (link_id, lesson_id) DO NOTHING'),
      ),
    ).toBe(true);
  });

  it('PG 驱动生成 IS NOT DISTINCT FROM（#27，PG 的 IS 不接受参数）', async () => {
    const { adb, sqls } = stubAsyncDb('pg');
    const repo = new PracticeLinkRepository(deadlyDb(), adb);
    await repo.findByTarget({ targetType: 'question', bankId: 1, questionId: 9, chapter: '', section: '' });
    expect(sqls[0]).toContain('question_id IS NOT DISTINCT FROM ?');
    expect(sqls[0]).not.toContain('question_id IS ?');
  });

  it('int8 收敛：PG 回来的字符串 id 变成 number', async () => {
    const { adb } = stubAsyncDb('pg', {
      get: () => ({ id: '11', target_type: 'bank', bank_id: '2', question_id: '3', chapter: '', section: '' }),
    });
    const repo = new PracticeLinkRepository(deadlyDb(), adb);
    const row = await repo.findById(11);
    expect(row).toMatchObject({ id: 11, bank_id: 2, question_id: 3 });
  });
});

describe('bankHealthCacheRepository + 协调器', () => {
  it('get/save 走 AsyncDb；save 是单行覆盖写', async () => {
    const { adb, sqls } = stubAsyncDb('sqlite', { get: () => ({ computed_at: 'x', payload: '{}' }) });
    const repo = new BankHealthCacheRepository(adb);
    await expect(repo.get()).resolves.toMatchObject({ computed_at: 'x' });
    await expect(repo.save('t', '{"a":1}')).resolves.toBeUndefined();
    expect(sqls[1]).toContain('ON CONFLICT(id) DO UPDATE');
  });

  it('checkpoint：sqlite 发 PRAGMA，pg 直接跳过', async () => {
    const sqlite = stubAsyncDb('sqlite');
    await new BankHealthCacheRepository(sqlite.adb).checkpoint();
    expect(sqlite.sqls.some((sql) => sql.includes('PRAGMA wal_checkpoint'))).toBe(true);

    const pg = stubAsyncDb('pg');
    await new BankHealthCacheRepository(pg.adb).checkpoint();
    expect(pg.sqls).toHaveLength(0);
  });

  it('协调器 get/status/ensureFresh 都是 Promise（缓存读变异步后不能漏 await）', async () => {
    const { adb } = stubAsyncDb('sqlite', { get: () => ({ computed_at: '2020-01-01T00:00:00.000Z', payload: '{}' }) });
    const cache = new BankHealthCacheRepository(adb);
    const payload: BankHealthPayload = {
      scope: { bankId: null, name: '全库' },
      stats: {
        total: 1,
        missingDifficulty: 0,
        emptyAnswer: 0,
        withImage: 0,
        withoutImage: 1,
        mediaOnlyAnalysis: 0,
        duplicateGroups: 0,
        duplicateQuestions: 0,
        conflictGroups: 0,
        noFingerprint: 0,
      },
      metadata: { withSubject: 1, withBook: 1, withPoint: 1, withHash: 1 },
      duplicates: [],
      kinds: [],
      difficulty: { unscored: 0, buckets: [], levels: [], sources: [], histogram: [] },
    };
    let calls = 0;
    const coordinator = new BankHealthCoordinator(cache, () => {
      calls += 1;
      return Promise.resolve(payload);
    });
    const first = coordinator.get();
    expect(first).toBeInstanceOf(Promise);
    const status = coordinator.status();
    expect(status).toBeInstanceOf(Promise);
    const warm = coordinator.ensureFresh();
    expect(warm).toBeInstanceOf(Promise);
    await Promise.all([first, status, warm]);
    // 过期缓存 + 自动体检开启 → 只起一次计算
    expect(calls).toBe(1);
    await coordinator.whenIdle();
  });
});

describe('装配层注入了 asyncDb', () => {
  const read = (file: string): string => fs.readFileSync(file, 'utf8');

  it('app.ts 的审计拿到同一个 asyncDb；体检装配内部取进程级 asyncDb', () => {
    const app = read('apps/api/src/app.ts');
    expect(app).toContain('new AuditRepository(db, asyncDb)');
    expect(app).toContain('createBankHealthCoordinator(db, config, settings');
    const setup = read('apps/api/src/services/bankHealthSetup.ts');
    expect(setup).toContain('new BankHealthCacheRepository(asyncDb)');
    expect(setup).toContain('getAsyncDb(config, db)');
  });

  it('practice-links 路由用进程级 asyncDb 构造仓储', () => {
    const route = read('apps/api/src/routes/practiceLinks.ts');
    expect(route).toContain('new PracticeLinkRepository(deps.db, getAsyncDb(deps.config, deps.db))');
  });
});

describe('sqlite 真库：练习链接读写一轮（读后写可见）', () => {
  let app: BuiltApp;
  let dataDir: string;
  let repo: PracticeLinkRepository;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-practice-links-async-'));
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
    repo = new PracticeLinkRepository(app.deps.db, createSqliteAsyncDb(app.deps.db));
    app.deps.db.run("INSERT INTO banks (id, name) VALUES (1, '练习题库')");
    app.deps.db.run("INSERT INTO lessons (id, title) VALUES (1, '课时一')");
    app.deps.db.run("INSERT INTO lessons (id, title) VALUES (2, '课时二')");
  });

  afterAll(async () => {
    await app.app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('readyz 探当前驱动（切流后不能只 ping SQLite）', async () => {
    const res = await app.app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', db: 'ok', driver: 'sqlite' });
  });

  it('create → findById / listByBank 读得到；课时关联幂等', async () => {
    const target = { targetType: 'bank', bankId: 1, questionId: null, chapter: '', section: '' };
    expect(await repo.findByTarget(target)).toBeUndefined();
    const link = await repo.insert(target);
    expect(link.id).toBe(1);
    expect(await repo.findById(link.id)).toMatchObject({ id: 1, target_type: 'bank', bank_id: 1 });

    await repo.setLessonIds(link.id, [1, 2]);
    expect((await repo.lessonsFor([link.id])).map((row) => row.lesson_id)).toEqual([1, 2]);
    // 重复追加不报错、changes 为 0
    expect(await repo.addLessonIds(link.id, [1, 2])).toBe(0);
    expect(await repo.addLessonIds(link.id, [3])).toBe(1);
    expect(await repo.listByLesson(3)).toHaveLength(1);

    // 覆盖式设置：多出来的课时被清掉
    await repo.setLessonIds(link.id, [1]);
    expect((await repo.lessonsFor([link.id])).map((row) => row.lesson_id)).toEqual([1]);

    await repo.delete(link.id);
    expect(await repo.findById(link.id)).toBeUndefined();
    expect(await repo.lessonsFor([link.id])).toEqual([]);
  });
});
