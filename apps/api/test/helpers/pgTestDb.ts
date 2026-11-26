/**
 * PG 集成测试的公共装置：连 `microclass_test`、重建 schema、执行 fixture DDL。
 *
 * 安全边界（硬规则）：
 *   - 只认 `MC_PG_TEST_URL`；不设就整组 skip（默认 vitest 仍是纯 sqlite）；
 *   - 连上后**先断言库名含 `test`**，否则直接抛出 —— 防止误连生产库 `microclass` 被 DROP SCHEMA；
 *   - 每个测试文件在 beforeAll 里重建一次 schema（幂等），用完关连接池。
 *
 * schema 来自 `test/fixtures/pg-schema.sql`（由 `ops/scripts/pg/gen-schema.mjs` + `post-schema.pg.sql`
 * 生成后固化），与生产同构：identity 主键、citext 标签名、3 个冗余列触发器、外键、部分索引。
 */
import fs from 'node:fs';
import { Client } from 'pg';
import type { Db } from '../../src/db/client.js';
import { createPgAsyncDb, type AsyncDb } from '../../src/db/async.js';
import { createPgPool } from '../../src/db/pg/pool.js';

export const PG_TEST_URL = process.env.MC_PG_TEST_URL ?? '';
export const pgEnabled = PG_TEST_URL !== '';

const SCHEMA_SQL = fs.readFileSync(new URL('../fixtures/pg-schema.sql', import.meta.url), 'utf8');

/** 只允许在测试库上跑：库名必须含 test */
export async function resetPgSchema(url: string = PG_TEST_URL): Promise<AsyncDb> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const dbName = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]?.db ?? '';
    if (!/test/i.test(dbName)) {
      throw new Error(`拒绝在非测试库上重建 schema：current_database()=${dbName}（库名必须含 test）`);
    }
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // fixture 自带 BEGIN/COMMIT 与 CREATE EXTENSION citext（post-schema 部分）
    await client.query(SCHEMA_SQL);
  } finally {
    await client.end();
  }
  return createPgAsyncDb(createPgPool({ url, max: 4 }));
}

/** 关掉连接池（每个 describe 的 afterAll 里调用） */
export async function closePg(db: AsyncDb): Promise<void> {
  await db.close();
}

/**
 * 同步 `Db` 桩：这些仓储已全部走 `AsyncDb`，一旦碰同步 Db 就抛错
 * （PG 模式下同步 Db 根本不存在，碰它就是跨库混合读写）。
 */
export function poisonSyncDb(): Db {
  const boom = (): never => {
    throw new Error('该仓储已迁 AsyncDb，不得再走同步 Db');
  };
  return { run: boom, get: boom, all: boom, transaction: boom } as unknown as Db;
}
