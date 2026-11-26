/**
 * exams 写 + attempts / 错题本（批次 2）的方言契约测试。
 *
 * 批次 1 的契约（读方法只经 AsyncDb）在 `exam-read-async.test.ts`，这里补**写路径的方言**：
 *   - #22 `INSERT OR IGNORE` / `INSERT OR REPLACE` → `ON CONFLICT DO NOTHING` / `DO UPDATE`
 *     （SQLite 与 PG 同一句 SQL，不再依赖 SQLite 专有语法）；
 *   - #22/#14 自增取 id → `INSERT … RETURNING id`（不再有 `lastInsertRowid`）；
 *   - #19 错题本 upsert 的 `unixepoch()` → 按驱动生成方言表达式（PG 侧不出现 unixepoch）；
 *   - #23 `LIKE` → `LOWER() LIKE LOWER()`（题池 keyword/point/chapter 与 pointStats.point）。
 *
 * 用桩记录 SQL 文本，不连真库；真事务/回滚见 `exam-write-transaction.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import type { AsyncDb } from '../src/db/async.js';
import type { Db } from '../src/db/client.js';
import { WrongQuestionRepository } from '../src/db/repositories/attemptRepository.js';
import { buildPickWhere } from '../src/db/repositories/exam-pool-filter.js';
import { ExamRepository } from '../src/db/repositories/examRepository.js';
import { pointStats } from '../src/db/repositories/exam-stats.js';
import { ProgressRepository } from '../src/db/repositories/progressRepository.js';
import { nowSeconds } from '../src/db/sql.js';

/** 记录所有经过 AsyncDb 的 SQL 文本；返回值按 SQL 关键字模拟（两条驱动同一套） */
function recorder(driver: 'sqlite' | 'pg'): { adb: AsyncDb; sql: string[] } {
  const sql: string[] = [];
  const holder: { adb?: AsyncDb } = {};
  const adb = {
    driver,
    all: async (text: string) => {
      sql.push(text);
      return [];
    },
    get: async (text: string) => {
      sql.push(text);
      if (text.includes('RETURNING id')) return { id: driver === 'pg' ? '7' : 7 };
      if (text.includes('MAX(sort)')) return { m: 3 };
      if (text.includes('FROM questions WHERE id = ?')) return { id: 1 };
      if (text.includes('FROM exam_questions WHERE exam_id = ? AND question_id = ?')) {
        return { sort: 1, score: 2.5, section: '一、单选' };
      }
      return undefined;
    },
    run: async (text: string) => {
      sql.push(text);
      return { changes: 1 };
    },
    transaction: async (fn: (tx: AsyncDb) => Promise<unknown>) => fn(holder.adb as AsyncDb),
    close: async () => undefined,
  } as unknown as AsyncDb;
  holder.adb = adb;
  return { adb, sql };
}

const dummyDb = {} as unknown as Db;

describe('方言 #22：ON CONFLICT 取代 INSERT OR IGNORE/REPLACE', () => {
  it('addQuestions 用 ON CONFLICT (exam_id, question_id) DO NOTHING', async () => {
    const { adb, sql } = recorder('sqlite');
    const repo = new ExamRepository(dummyDb, adb);
    expect(await repo.addQuestions(5, [7, 8])).toBe(2);
    const joined = sql.join('\n');
    expect(joined).toContain('ON CONFLICT (exam_id, question_id) DO NOTHING');
    expect(joined).not.toContain('INSERT OR IGNORE');
  });

  it('replaceQuestion 先删后插，冲突时 DO UPDATE（等价 REPLACE，保持位置/分值/大题）', async () => {
    const { adb, sql } = recorder('sqlite');
    const repo = new ExamRepository(dummyDb, adb);
    await repo.replaceQuestion(5, 7, 8);
    const joined = sql.join('\n');
    expect(joined).toContain('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?');
    expect(joined).toContain('ON CONFLICT (exam_id, question_id) DO UPDATE SET');
    expect(joined).toContain('sort = excluded.sort');
    expect(joined).not.toContain('INSERT OR REPLACE');
  });

  it('组卷落库（applyComposition）也只用 ON CONFLICT DO NOTHING', async () => {
    const { adb, sql } = recorder('sqlite');
    const repo = new ExamRepository(dummyDb, adb);
    const added = await repo.applyComposition(5, {
      replaceExisting: true,
      questionIds: [7],
      meta: new Map([[7, { score: 10, section: '一、单选' }]]),
    });
    expect(added).toBe(1);
    const joined = sql.join('\n');
    expect(joined).toContain('DELETE FROM exam_questions WHERE exam_id = ?');
    expect(joined).toContain('ON CONFLICT (exam_id, question_id) DO NOTHING');
    expect(joined).not.toContain('INSERT OR IGNORE');
  });
});

describe('方言 #14/#22：自增统一 RETURNING id', () => {
  it('考试 create 与交卷 recordAttempt 用 RETURNING id，并把 int8 字符串收敛成 number', async () => {
    const { adb, sql } = recorder('pg');
    const repo = new ExamRepository(dummyDb, adb);
    expect(await repo.create({ courseId: 3, title: '方言考试' })).toBe(7);
    expect(
      await repo.recordAttempt({
        examId: 5,
        userId: 9,
        answers: [],
        score: 0,
        total: 0,
        passed: false,
        usedSeconds: 3,
      }),
    ).toBe(7);
    const joined = sql.join('\n');
    expect(joined).toContain('RETURNING id');
    expect(joined).not.toContain('lastInsertRowid');
  });
});

describe('方言 #19：unixepoch() 按驱动生成', () => {
  it('SQLite 用 unixepoch()，PG 用 EXTRACT(EPOCH FROM now())', () => {
    expect(nowSeconds('sqlite')).toBe('unixepoch()');
    expect(nowSeconds('pg')).toBe('(EXTRACT(EPOCH FROM now()))::bigint');
  });

  it('错题本写路径在 PG 下不出现 unixepoch()', async () => {
    const { adb, sql } = recorder('pg');
    const repo = new WrongQuestionRepository(dummyDb, adb);
    await repo.upsertWrong(1, 2);
    await repo.markMastered(1, 2);
    await repo.setMastered(1, 2, true);
    const joined = sql.join('\n');
    expect(joined).not.toContain('unixepoch()');
    expect(joined).toContain('EXTRACT(EPOCH FROM now())');
  });

  it('同一个仓储在 SQLite 下仍用 unixepoch()（行为与迁移前一致）', async () => {
    const { adb, sql } = recorder('sqlite');
    const repo = new WrongQuestionRepository(dummyDb, adb);
    await repo.upsertWrong(1, 2);
    expect(sql.join('\n')).toContain('unixepoch()');
  });

  it('学习进度 upsert 也走同一方言表达式（顺带清掉 progress 的 #19 待办）', async () => {
    const pg = recorder('pg');
    await new ProgressRepository(dummyDb, pg.adb).upsert({
      userId: 1,
      lessonId: 2,
      position: 3,
      duration: 4,
      finished: false,
    });
    expect(pg.sql.join('\n')).not.toContain('unixepoch()');
    expect(pg.sql.join('\n')).toContain('EXTRACT(EPOCH FROM now())');

    const sqlite = recorder('sqlite');
    await new ProgressRepository(dummyDb, sqlite.adb).markQuizDone(1, 2, 60);
    expect(sqlite.sql.join('\n')).toContain('unixepoch()');
  });
});

describe('方言 #23：LIKE 大小写确认站点', () => {
  it('题池 keyword/point/chapter 用 LOWER() LIKE LOWER()', () => {
    const { where } = buildPickWhere({ keyword: '常量', point: '分数', chapter: '第一章' });
    expect(where).toContain('LOWER(q.stem) LIKE LOWER(?)');
    expect(where).toContain('LOWER(q.point) LIKE LOWER(?)');
    expect(where).toContain('LOWER(q.chapter) LIKE LOWER(?)');
    // 不再有「依赖 SQLite 默认大小写不敏感」的裸 LIKE
    expect(where).not.toMatch(/q\.(stem|point|chapter) LIKE \?/);
  });

  it('pointStats.point 同样走 likeCI', async () => {
    const { adb, sql } = recorder('pg');
    await pointStats(adb, { point: '分数' });
    expect(sql[0]).toContain('LOWER(q.point) LIKE LOWER(?)');
    expect(sql[0]).not.toContain('q.point LIKE ?');
  });
});
