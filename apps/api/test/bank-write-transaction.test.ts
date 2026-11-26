/**
 * 写方法的事务语义：**整批回滚**。
 *
 * 背景（B3b）：`setCourseBindings` / `applyBankSections` 从 `db.transaction`（sqlite 同步）改成
 * `AsyncDb.transaction`（sqlite：BEGIN IMMEDIATE；PG：单连接 BEGIN + ROLLBACK）。
 * 语义必须一致：**回调里任何一条失败，前面已执行的更新也要回滚**。
 *
 * 本文件默认只跑 sqlite（内存库）；
 * PG 分支需要 `MC_PG_TEST_URL`（按硬规则不在生产机器上跑，留给切流预演/CI）：
 *   MC_PG_TEST_URL=postgres://… npx vitest run apps/api/test/bank-write-transaction.test.ts
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
import { setBankSections } from '../src/db/repositories/bankSectionQueries.js';
import { setCourseBindings } from '../src/db/repositories/bankBindingQueries.js';
import type { AsyncDb } from '../src/db/async.js';

let dataDir: string;
let built: BuiltApp;
let db: Db;
let asyncDb: AsyncDb;
let banks: BankRepository;

async function makeBank(name: string, courseId: number | null = null): Promise<number> {
  return banks.create({ name, kind: 'chapter', subject: '数学', book: '测试册', courseId });
}

async function sectionOf(id: number): Promise<string> {
  const row = await asyncDb.get<{ section: string }>('SELECT section FROM banks WHERE id = ?', [id]);
  return row?.section ?? '(missing)';
}

async function courseOf(id: number): Promise<number | null> {
  const row = await asyncDb.get<{ course_id: number | null }>('SELECT course_id FROM banks WHERE id = ?', [id]);
  return row?.course_id ?? null;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-write-tx-'));
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
});

afterAll(async () => {
  await built.app.close();
  resetAsyncDbCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('AsyncDb.transaction：sqlite 与 PG 同一语义', () => {
  it('回调抛错 → 事务内已执行的写全部回滚', async () => {
    const id = await makeBank('回滚用例');

    await expect(
      asyncDb.transaction(async (tx) => {
        await tx.run('UPDATE banks SET name = ? WHERE id = ?', ['被改过的名字', id]);
        throw new Error('模拟中途失败');
      }),
    ).rejects.toThrow('模拟中途失败');

    const row = await asyncDb.get<{ name: string }>('SELECT name FROM banks WHERE id = ?', [id]);
    expect(row?.name).toBe('回滚用例');
  });

  it('回调正常 → 提交生效', async () => {
    const id = await makeBank('提交用例');
    await asyncDb.transaction(async (tx) => {
      await tx.run('UPDATE banks SET name = ? WHERE id = ?', ['提交后的名字', id]);
    });
    const row = await asyncDb.get<{ name: string }>('SELECT name FROM banks WHERE id = ?', [id]);
    expect(row?.name).toBe('提交后的名字');
  });
});

describe('批量写：一条失败 → 整批回滚', () => {
  it('setBankSections：第二条违反 NOT NULL → 第一条也不落库', async () => {
    const a = await makeBank('批量章节A');
    const b = await makeBank('批量章节B');

    await expect(
      setBankSections(asyncDb, [
        { id: a, section: '第一章' },
        { id: b, section: null as unknown as string }, // NOT NULL 违约，触发中途失败
      ]),
    ).rejects.toThrow();

    expect(await sectionOf(a)).toBe('');
    expect(await sectionOf(b)).toBe('');
  });

  it('setCourseBindings：正常提交 → 两条都改到', async () => {
    // 外键要求 courses 里真有一门课
    await asyncDb.run('INSERT INTO courses (id, name) VALUES (9001, ?)', ['事务测试课程']);
    const a = await makeBank('绑定A');
    const b = await makeBank('绑定B');
    const changed = await setCourseBindings(asyncDb, [
      { bankId: a, courseId: 9001 },
      { bankId: b, courseId: 9001 },
    ]);
    expect(changed).toBe(2);
    expect(await courseOf(a)).toBe(9001);
    expect(await courseOf(b)).toBe(9001);
  });

  it('setBankSections：正常提交 → 只改仍为空的题库', async () => {
    const a = await makeBank('章节A');
    const b = await makeBank('章节B');
    const changed = await setBankSections(asyncDb, [
      { id: a, section: '第二章' },
      { id: b, section: '第二章' },
    ]);
    expect(changed).toBe(2);
    expect(await sectionOf(a)).toBe('第二章');
    // 已填过的不再覆盖
    const again = await setBankSections(asyncDb, [{ id: a, section: '第三章' }]);
    expect(again).toBe(0);
    expect(await sectionOf(a)).toBe('第二章');
  });
});

describe('仓储写方法走 AsyncDb（create 用 RETURNING id）', () => {
  it('create → 返回自增 id，可被 findById 读到', async () => {
    const id = await makeBank('RETURNING 用例');
    expect(id).toBeGreaterThan(0);
    const row = await banks.findById(id);
    expect(row?.name).toBe('RETURNING 用例');
  });

  it('update → 读旧值合并（undefined 不动、null 显式移出课程）', async () => {
    const id = await makeBank('更新用例', null);
    await banks.update(id, { name: '更新后', kind: 'paper', subject: '物理', book: '新册' });
    const row = await banks.findById(id);
    expect(row?.name).toBe('更新后');
    expect(row?.kind).toBe('paper');
    expect(row?.subject).toBe('物理');
  });

  it('delete → 删掉后查不到', async () => {
    const id = await makeBank('删除用例');
    await banks.delete(id);
    expect(await banks.findById(id)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* PG 分支：需要 MC_PG_TEST_URL；本机不跑（硬规则），留给切流预演/CI   */
/* ------------------------------------------------------------------ */
const PG_URL = process.env.MC_PG_TEST_URL ?? '';

describe.skipIf(!PG_URL)('PG：同样的整批回滚语义', () => {
  it('事务抛错 → 回滚（PG 单连接 BEGIN/ROLLBACK）', async () => {
    const { createPgAsyncDb } = await import('../src/db/async.js');
    const { createPgPool } = await import('../src/db/pg/pool.js');
    const pg = createPgAsyncDb(createPgPool({ url: PG_URL, max: 2 }));
    try {
      await pg.run('DROP TABLE IF EXISTS tx_probe');
      await pg.run('CREATE TABLE tx_probe (id integer PRIMARY KEY, label text NOT NULL)');
      await pg.run("INSERT INTO tx_probe (id, label) VALUES (1, '初始')");

      await expect(
        pg.transaction(async (tx) => {
          await tx.run("UPDATE tx_probe SET label = '改过' WHERE id = 1");
          throw new Error('模拟中途失败');
        }),
      ).rejects.toThrow('模拟中途失败');

      const row = await pg.get<{ label: string }>('SELECT label FROM tx_probe WHERE id = 1');
      expect(row?.label).toBe('初始');

      // 批量回滚：第二条违反 NOT NULL
      await expect(
        pg.transaction(async (tx) => {
          await tx.run("UPDATE tx_probe SET label = '第一章' WHERE id = 1");
          await tx.run('INSERT INTO tx_probe (id, label) VALUES (2, NULL)');
        }),
      ).rejects.toThrow();

      expect((await pg.get<{ label: string }>('SELECT label FROM tx_probe WHERE id = 1'))?.label).toBe('初始');
      await pg.run('DROP TABLE tx_probe');
    } finally {
      await pg.close();
    }
  });
});
