/**
 * questions 写方法的事务语义（B3b）。
 *
 * 关注点：
 *   1. `insertMany` 中途失败 → 整批回滚（含 `banks.question_count` 不会被加错）；
 *   2. `insertMany` 空数组是 no-op（幂等边界）；
 *   3. `create` 用 `RETURNING id`，并且同步维护 `banks.question_count`；
 *   4. `deleteMany` 一个事务：中途失败整批回滚（题量与题目都要恢复）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { Db } from '../src/db/client.js';
import { loadConfig } from '../src/config/env.js';
import { getAsyncDb, resetAsyncDbCache } from '../src/db/driver.js';
import { BankRepository } from '../src/db/repositories/bankRepository.js';
import { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import type { AsyncDb } from '../src/db/async.js';
import type { QuestionInput } from '../src/db/repositories/question-types.js';

let dataDir: string;
let built: BuiltApp;
let db: Db;
let asyncDb: AsyncDb;
let banks: BankRepository;
let questions: QuestionRepository;
let bankId = 0;

function q(stem: string): QuestionInput {
  return { bankId, type: 'single', stem, options: ['A. 选项甲', 'B. 选项乙'], answer: '0' };
}

async function countQuestions(): Promise<number> {
  const row = await asyncDb.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [bankId]);
  return row?.c ?? 0;
}

async function bankCount(): Promise<number> {
  const row = await asyncDb.get<{ c: number }>('SELECT question_count AS c FROM banks WHERE id = ?', [bankId]);
  return row?.c ?? 0;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-qwrite-'));
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
  questions = new QuestionRepository(db, asyncDb);
  bankId = await banks.create({ name: '写事务测试库', kind: 'chapter', subject: '数学', book: '测试册' });
});

afterAll(async () => {
  await built.app.close();
  resetAsyncDbCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('questions 写方法', () => {
  it('create → RETURNING id，并同步维护 banks.question_count', async () => {
    const before = await bankCount();
    const id = await questions.create(q('单选题：1+1 等于几'));
    expect(id).toBeGreaterThan(0);
    expect(await countQuestions()).toBe(1);
    expect(await bankCount()).toBe(before + 1);
    const row = questions.findById(id);
    expect(row?.stem).toBe('单选题：1+1 等于几');
  });

  it('insertMany([]) → 0（幂等边界，不建事务）', async () => {
    expect(await questions.insertMany([])).toBe(0);
  });

  it('insertMany 正常 → 批量写入且题量只加一次', async () => {
    const before = await bankCount();
    const inserted = await questions.insertMany([q('批量题一'), q('批量题二'), q('批量题三')]);
    expect(inserted).toBe(3);
    expect(await bankCount()).toBe(before + 3);
  });

  it('insertMany 中途失败 → 整批回滚（题目与题量都不变）', async () => {
    const beforeQ = await countQuestions();
    const beforeCount = await bankCount();
    // 第 3 条 stem 为 null（NOT NULL 违约）→ 抛错，前两条必须回滚
    const bad = [q('会被回滚一'), q('会被回滚二'), { ...q('占位'), stem: null as unknown as string }];

    await expect(questions.insertMany(bad)).rejects.toThrow();

    expect(await countQuestions()).toBe(beforeQ);
    expect(await bankCount()).toBe(beforeCount);
  });

  it('deleteMany 正常 → 删除并回减题量', async () => {
    const ids = [await questions.create(q('待删一')), await questions.create(q('待删二'))];
    const before = await bankCount();
    expect(await questions.deleteMany(ids)).toBe(2);
    expect(await bankCount()).toBe(before - 2);
  });

  it('deleteMany 中途失败 → 整批回滚（已删的题要回来）', async () => {
    const a = await questions.create(q('回滚删除甲'));
    const b = await questions.create(q('回滚删除乙'));
    const beforeQ = await countQuestions();
    const beforeCount = await bankCount();

    // 用一个临时触发器让「删 b」必定失败，从而验证 a 的删除被回滚
    await asyncDb.run(
      `CREATE TRIGGER trg_block_delete BEFORE DELETE ON questions WHEN OLD.id = ${b}
       BEGIN SELECT RAISE(ABORT, 'blocked-by-test-trigger'); END`,
    );
    try {
      await expect(questions.deleteMany([a, b])).rejects.toThrow();
      expect(await countQuestions()).toBe(beforeQ);
      expect(await bankCount()).toBe(beforeCount);
      expect(questions.findById(a)).toBeTruthy();
      expect(questions.findById(b)).toBeTruthy();
    } finally {
      await asyncDb.run('DROP TRIGGER IF EXISTS trg_block_delete');
    }
  });

  it('setSections → 只改本库的题', async () => {
    const id = await questions.create(q('章节测试题'));
    const other = await banks.create({ name: '另一个题库', kind: 'chapter', subject: '数学', book: '测试册' });
    const foreign = await questions.create({ ...q('跨库题'), bankId: other });

    const updated = await questions.setSections(bankId, [id, foreign], { chapter: '第一章' });
    expect(updated).toBe(1);
    expect(questions.findById(id)?.chapter).toBe('第一章');
    expect(questions.findById(foreign)?.chapter).toBe('');
  });
});
