/**
 * 全库体检计算子进程（2.3.2 起；B2 调整）。
 *
 * 为什么是子进程：线程共享进程优先级，Node 不暴露 ioprio；只有独立进程才能用
 * `ionice -c3 nice -n 19` 把 39.6 万题的全表扫描压到最低优先级。
 *
 * 数据来源（**过渡态，B3 迁移完成后要改**）：
 *   - 题目/题库聚合：仍读 **SQLite**（read-only 连接）——questions/banks 仓储还是同步 sqlite 实现；
 *   - 站内设置（难度阈值等）：按 `MC_DB` 走对应库（`pg` 连接 `MC_PG_URL`，否则复用上面的 sqlite 连接），
 *     启动时 `await settings.load()` 把 settings 快照读进内存，之后同步读。
 *   B3 把 questions/banks 迁到 PG 后，这里应该改成「只连 PG、不再开 sqlite」。
 *
 * 输出约定：一行 JSON（`{ok:true,payload}` 或 `{ok:false,error}`），由 services/bankHealthRunner 解析。
 */
import { writeSync } from 'node:fs';
import { Db } from '../db/client.js';
import { createPgAsyncDb, createSqliteAsyncDb, type AsyncDb } from '../db/async.js';
import { createPgPool } from '../db/pg/pool.js';
import { SettingsRepository } from '../db/repositories/settingsRepository.js';
import { computeGlobalHealthPayload } from '../db/repositories/bankHealthPayload.js';

const dbFile = process.env.MC_HEALTH_DB ?? '';
const limit = Number(process.env.MC_HEALTH_LIMIT ?? 20);

function fail(error: string): never {
  // 用 writeSync + 显式退出码：process.exit 会截断未 flush 的 stdout（曾导致线上只看到空输出）
  writeSync(1, JSON.stringify({ ok: false, error }));
  process.exit(1);
}

if (!dbFile) fail('体检子进程缺少 MC_HEALTH_DB');

try {
  const db = new Db(dbFile, { readOnly: true });
  // 过渡点（B3 后改）：题库聚合读 sqlite；settings 按 MC_DB 走 PG 或 sqlite
  let asyncDb: AsyncDb;
  const pgUrl = process.env.MC_PG_URL;
  if (process.env.MC_DB === 'pg' && pgUrl) {
    asyncDb = createPgAsyncDb(createPgPool({ url: pgUrl, max: 1 }));
  } else {
    asyncDb = createSqliteAsyncDb(db);
  }
  try {
    const settings = new SettingsRepository(asyncDb);
    await settings.load();
    const payload = computeGlobalHealthPayload(db, settings, limit);
    process.stdout.write(JSON.stringify({ ok: true, payload }));
  } finally {
    db.close();
    await asyncDb.close();
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
