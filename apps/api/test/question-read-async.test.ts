/**
 * questions 域「读写都走 AsyncDb」的契约测试（2026-11-27，questions 读批次）。
 *
 * 为什么单独钉（交接文档 §7.7 的风险）：
 *   1. `tsc` 抓不到「方法忘了走 asyncDb」—— 漏了在 sqlite 下照样能跑，
 *      但 PG 模式下会变成「读 SQLite、写 PG」的跨库混合路径（切流前必须清零）；
 *   2. **读后写不可见**是最致命的失败模式：`create/update/import` 之后紧接的
 *      `findById`/`listByBank` 若还查 SQLite，PG 模式下会 404 或列表缺新题；
 *      所以这里必须有一条「create → findById 能读到」的真库用例；
 *   3. `app.ts` 必须注入 `asyncDb`：只补 DI 不改读方法 = 写 PG 读 SQLite，
 *      只改读方法不补 DI = 写 SQLite 读 PG，两者同批修；
 *   4. PG 的 `COUNT/SUM` 是 int8，node-postgres 默认回传**字符串**（方言 #17），
 *      计数必须在仓储边界收敛成 number，否则接口返回 "3" 而不是 3；
 *   5. 易错题挑题的 JSON 展开曾是 SQLite 专有写法（方言 #24），PG 模式会直接报错。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { types } from 'pg';
import '../src/db/pg/pool.js'; // 副作用：注册 int8（OID 20）→ number 的全局 parser（方言 #17）
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import type { AsyncDb, DbDriverName } from '../src/db/async.js';
import { maxOf, naturalNumberPrefix } from '../src/db/sql.js';
import { BankRepository } from '../src/db/repositories/bankRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import { QuestionStatsRepository } from '../src/db/repositories/questionStatsRepository.js';
import type { QuestionInput } from '../src/db/repositories/question-types.js';

/** 同步 Db 桩：19 个读方法迁完后一个都不该再走它（一旦调用就是跨库混合读写） */
function stubDb(): {
  db: Db;
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(() => ({ changes: 1 }));
  const get = vi.fn(() => undefined);
  const all = vi.fn(() => []);
  const transaction = vi.fn((fn: () => unknown) => fn());
  return { db: { run, get, all, transaction } as unknown as Db, run, get, all };
}

/** 异步端口桩：记录 SQL，返回值可按 SQL 定制 */
function stubAsyncDb(
  driver: DbDriverName = 'sqlite',
  handlers: { all?: (sql: string) => unknown[]; get?: (sql: string) => unknown } = {},
): { adb: AsyncDb; all: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } {
  const all = vi.fn(async (sql: string) => handlers.all?.(sql) ?? []);
  const get = vi.fn(async (sql: string) => handlers.get?.(sql));
  const run = vi.fn(async () => ({ changes: 0 }));
  const adb = {
    driver,
    all,
    get,
    run,
    transaction: vi.fn(async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(adb)),
    close: vi.fn(async () => undefined),
  } as unknown as AsyncDb;
  return { adb, all, get, run };
}

const CUTS = { easyMax: 40, mediumMax: 70, five: [20, 40, 60, 80] as [number, number, number, number] };

describe('questions 读批次：19 个读方法全部返回 Promise，且只经 AsyncDb', () => {
  const readCases: { name: string; call: (repo: QuestionRepository) => Promise<unknown> }[] = [
    { name: 'listByBank', call: (r) => r.listByBank(1) },
    { name: 'countByBank', call: (r) => r.countByBank(1) },
    { name: 'listAll', call: (r) => r.listAll(undefined, { limit: 1, offset: 0 }) },
    { name: 'countAll', call: (r) => r.countAll() },
    { name: 'findById', call: (r) => r.findById(5) },
    { name: 'findByIds', call: (r) => r.findByIds([5]) },
    { name: 'listByLesson', call: (r) => r.listByLesson(7) },
    { name: 'difficultyFeatures', call: (r) => r.difficultyFeatures() },
    { name: 'stemsByIds', call: (r) => r.stemsByIds([5]) },
    { name: 'allDifficultyScores', call: (r) => r.allDifficultyScores() },
    { name: 'difficultyScoreOf', call: (r) => r.difficultyScoreOf(5) },
    { name: 'answerStats', call: (r) => r.answerStats() },
    { name: 'difficultyStats', call: (r) => r.difficultyStats(undefined, CUTS) },
    { name: 'health', call: (r) => r.health() },
    { name: 'countByMeta', call: (r) => r.countByMeta(undefined, 'subject') },
    { name: 'searchByMeta', call: (r) => r.searchByMeta({}) },
    { name: 'pointStats', call: (r) => r.pointStats({}) },
    { name: 'duplicateGroups', call: (r) => r.duplicateGroups(10) },
    { name: 'duplicateIdsInBank', call: (r) => r.duplicateIdsInBank(1) },
  ];

  for (const { name, call } of readCases) {
    it(`${name}() 返回 Promise，且不碰同步 Db`, async () => {
      const { db, get: syncGet, all: syncAll } = stubDb();
      const { adb, all, get, run } = stubAsyncDb();
      const repo = new QuestionRepository(db, adb);

      const pending = call(repo);
      expect(pending).toBeInstanceOf(Promise);
      await pending;

      expect(all.mock.calls.length + get.mock.calls.length + run.mock.calls.length).toBeGreaterThan(0);
      expect(syncGet).not.toHaveBeenCalled();
      expect(syncAll).not.toHaveBeenCalled();
    });
  }
});

describe('questions 读批次：PG int8 在仓储边界收敛成 number（方言 #17）', () => {
  it('countByBank / countAll / countByMeta 把 "3" 收敛成 3', async () => {
    const { db } = stubDb();
    const { adb } = stubAsyncDb('pg', { get: () => ({ c: '3' }) });
    const repo = new QuestionRepository(db, adb);

    expect(await repo.countByBank(1)).toBe(3);
    expect(await repo.countAll()).toBe(3);
    // 已知总数时只查空值数：3 − 1 = 2
    const known = stubAsyncDb('pg', { get: () => ({ c: '1' }) });
    expect(await new QuestionRepository(db, known.adb).countByMeta(undefined, 'subject', 3)).toBe(2);
  });

  it('health / pointStats / duplicateGroups 的聚合列也是 number', async () => {
    const { db } = stubDb();
    const { adb } = stubAsyncDb('pg', {
      all: (sql) => {
        if (sql.includes('AS questions')) {
          return [
            {
              subject: '数学',
              book: 'S1',
              point: '加法',
              questions: '4',
              easy: '1',
              medium: '2',
              hard: '1',
              banks: '2',
            },
          ];
        }
        if (sql.includes('COUNT(DISTINCT answer) AS answers')) {
          return [{ content_hash: 'h1', n: '3', answers: '1', stem: '题干' }];
        }
        return [];
      },
      get: (sql) => (sql.includes('SUM(n)') ? { groups: '2', questions: '5', conflicts: '1' } : { c: '7' }),
    });
    const repo = new QuestionRepository(db, adb);

    const health = await repo.health();
    expect(health.total).toBe(7);
    expect(health.withImage).toBe(7);
    expect(health.withoutImage).toBe(0);
    expect(health.duplicateGroups).toBe(2);
    expect(health.conflictGroups).toBe(1);

    const points = await repo.pointStats({});
    expect(points[0]?.questions).toBe(4);
    expect(points[0]?.banks).toBe(2);

    const groups = await repo.duplicateGroups(10);
    expect(groups[0]?.n).toBe(3);
    expect(groups[0]?.answers).toBe(1);
  });
});

describe('questions 读批次：读后写可见（真 SQLite，create → findById/listByLesson）', () => {
  let dataDir: string;
  let built: BuiltApp;
  let db: Db;
  let asyncDb: AsyncDb;
  let banks: BankRepository;
  let bankId = 0;
  let lessonId = 0;

  const input = (stem: string, extra?: Partial<QuestionInput>): QuestionInput => ({
    bankId,
    type: 'single',
    stem,
    options: ['A. 选项甲', 'B. 选项乙'],
    answer: '0',
    ...extra,
  });

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-qread-'));
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
    banks = new BankRepository(db, asyncDb);
    bankId = await banks.create({ name: '读批次测试库', kind: 'chapter', subject: '数学', book: '测试册' });
    const lesson = await asyncDb.get<{ id: number }>(
      `INSERT INTO lessons (title, description, video_kind, video_path, sort)
       VALUES ('第1课', '', 'local', 'videos/a.mp4', 0) RETURNING id`,
    );
    lessonId = Number(lesson?.id ?? 0);
  });

  afterAll(async () => {
    await built.app.close();
    resetAsyncDbCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('create 之后立刻 findById 能读到（读后写可见）', async () => {
    const repo = built.deps.questions;
    const id = await repo.create(input('读后写可见的题'));
    const row = await repo.findById(id);
    expect(row?.stem).toBe('读后写可见的题');
    expect(row?.bank_id).toBe(bankId);
  });

  it('sync Db 被打死时读方法仍然工作（证明只经 AsyncDb）', async () => {
    const poisoned = {
      run: () => {
        throw new Error('读方法不得走同步 Db');
      },
      get: () => {
        throw new Error('读方法不得走同步 Db');
      },
      all: () => {
        throw new Error('读方法不得走同步 Db');
      },
      transaction: () => {
        throw new Error('读方法不得走同步 Db');
      },
    } as unknown as Db;
    const created = await built.deps.questions.create(input('只经 AsyncDb 的题', { lessonId }));
    const repo = new QuestionRepository(poisoned, asyncDb);

    expect((await repo.findById(created))?.stem).toBe('只经 AsyncDb 的题');
    const byLesson = await repo.listByLesson(lessonId);
    expect(byLesson.map((q) => q.id)).toContain(created);
    expect((await repo.listByBank(bankId)).length).toBeGreaterThan(0);
    expect(await repo.countByBank(bankId)).toBeGreaterThan(0);
  });

  it('app.ts 给 questions / questionStats 都注入了 asyncDb', () => {
    const wired = built.deps.questions as unknown as { asyncDb?: AsyncDb };
    expect(wired.asyncDb).toBeDefined();
    const stats = built.deps.questionStats as unknown as { asyncDb?: AsyncDb };
    expect(stats.asyncDb).toBeDefined();
  });
});

describe('易错题挑题：JSON 展开改方言辅助（#24），int8 收敛（#17）', () => {
  it('SQLite 侧仍是 json_each/json_extract（SQL 文本与迁移前一致）', async () => {
    const { adb, all } = stubAsyncDb('sqlite', { all: () => [] });
    await new QuestionStatsRepository(adb).errorByQuestion();
    const sql = String(all.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('json_each');
    expect(sql).toContain("json_extract(je.value, '$.qid')");
    expect(sql).not.toContain('jsonb_array_elements');
  });

  it('PG 侧不再出现 json_each，且 correct:null 仍是 NULL（被 IN (1,0) 排除）', async () => {
    const { adb, all } = stubAsyncDb('pg', { all: () => [] });
    await new QuestionStatsRepository(adb).errorByQuestion();
    const sql = String(all.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('jsonb_array_elements');
    expect(sql).toContain("->>'qid'");
    expect(sql).toContain("= 'true' THEN 1");
    expect(sql).not.toContain('json_each');
    expect(sql).not.toContain('json_extract');
  });

  it('int8 字符串（n / wrong / qid）在仓储边界收敛成 number', async () => {
    const { adb } = stubAsyncDb('pg', { all: () => [{ qid: '7', n: '4', wrong: '3' }] });
    const stats = await new QuestionStatsRepository(adb).errorByQuestion();
    const row = stats.get(7);
    expect(row?.attempts).toBe(4);
    expect(row?.wrong).toBe(3);
    expect(row?.rate).toBeCloseTo(0.75);
  });

  it('缓存命中时不再查库（refresh 才重算）', async () => {
    const { adb, all } = stubAsyncDb('sqlite', { all: () => [{ qid: 1, n: 1, wrong: 1 }] });
    const repo = new QuestionStatsRepository(adb);
    await repo.errorByQuestion();
    await repo.errorByQuestion();
    expect(all).toHaveBeenCalledTimes(1);
    await repo.errorByQuestion({ refresh: true });
    expect(all).toHaveBeenCalledTimes(2);
    expect(repo.cachedAt()).toBeGreaterThan(0);
  });
});

describe('方言收尾：#16 自然序 / #20 标量 MAX / #17 全局 int8 parser', () => {
  it('#16 课时自然序按驱动生成（sqlite 原样 CAST，pg 不再 CAST 非数字标题）', () => {
    expect(naturalNumberPrefix('title', 'sqlite')).toBe('CAST(title AS INTEGER)');
    const pg = naturalNumberPrefix('title', 'pg');
    expect(pg).not.toContain('CAST(title AS INTEGER)');
    expect(pg).toContain("substring(trim(title) from '^[+-]?[0-9]+')");
    expect(pg).toContain('COALESCE');
  });

  it('#20 两参取大按驱动生成（sqlite MAX(a,b) / pg GREATEST）', () => {
    expect(maxOf('finished', 'excluded.finished', 'sqlite')).toBe('MAX(finished, excluded.finished)');
    expect(maxOf('finished', 'excluded.finished', 'pg')).toBe('GREATEST(finished, excluded.finished)');
  });

  it('#17 int8 parser 已全局注册：OID 20 解析成 number', () => {
    const parser = types.getTypeParser(20) as (value: string) => unknown;
    expect(parser('42')).toBe(42);
    expect(parser('0')).toBe(0);
  });
});
