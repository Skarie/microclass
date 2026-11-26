/**
 * 全库体检计算子进程（2.3.2 起；B2 调整）。
 *
 * 为什么是子进程：线程共享进程优先级，Node 不暴露 ioprio；只有独立进程才能用
 * `ionice -c3 nice -n 19` 把 39.6 万题的全表扫描压到最低优先级。
 *
 * 数据来源（P0 阶段 2 收尾后）：**只看 `MC_DB`**
 *   - `MC_DB=pg`：只连 PG（`MC_PG_URL`），题目/题库聚合与设置都走同一个连接池；
 *     **不再打开只读 SQLite，`MC_HEALTH_DB` 也不再是必需项**（切流后 sqlite 只是历史归档）；
 *   - 其它（默认 sqlite）：沿用原来的「只读 SQLite 连接」+ `MC_HEALTH_DB`。
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
const pgUrl = process.env.MC_PG_URL ?? '';
/** PG 模式：只连 PG；缺 `MC_PG_URL` 时仍按 sqlite 处理（保持既有回退语义） */
const pgMode = process.env.MC_DB === 'pg' && pgUrl !== '';
const limit = Number(process.env.MC_HEALTH_LIMIT ?? 20);

function fail(error: string): never {
  // 用 writeSync + 显式退出码：process.exit 会截断未 flush 的 stdout（曾导致线上只看到空输出）
  writeSync(1, JSON.stringify({ ok: false, error }));
  process.exit(1);
}

if (!pgMode && !dbFile) fail('体检子进程缺少 MC_HEALTH_DB（sqlite 模式必需）');

try {
  // PG 模式下 db 传 null：QuestionRepository / BankRepository 只走注入的 AsyncDb，
  // 不会碰 SQLite（也就不会因为打不开历史库而整次体检失败）。
  const db = pgMode ? null : new Db(dbFile, { readOnly: true });
  const asyncDb: AsyncDb = db ? createSqliteAsyncDb(db) : createPgAsyncDb(createPgPool({ url: pgUrl, max: 1 }));
  try {
    const settings = new SettingsRepository(asyncDb);
    await settings.load();
    const payload = await computeGlobalHealthPayload(db, asyncDb, settings, limit);
    process.stdout.write(JSON.stringify({ ok: true, payload }));
  } finally {
    db?.close();
    await asyncDb.close();
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
