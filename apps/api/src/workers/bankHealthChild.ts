/**
 * 全库体检计算子进程（2.3.2）。
 *
 * 为什么从 worker_threads 改成子进程：线程共享进程优先级，Node 不暴露 ioprio；
 * 只有独立进程才能用 `ionice -c3 nice -n 19` 把 39.6 万题的全表扫描压到最低优先级，
 * 避免它和主服务的请求抢同一块机械盘。
 *
 * 约定：结果以一行 JSON 写到 stdout（`{ok:true,payload}` 或 `{ok:false,error}`），
 * 由 `services/bankHealthRunner` 解析；进程不写库（只读连接）。
 */
import { Db } from '../db/client.js';
import { computeGlobalHealthPayload } from '../db/repositories/bankHealthPayload.js';

const dbFile = process.env.MC_HEALTH_DB ?? '';
const limit = Number(process.env.MC_HEALTH_LIMIT ?? 20);

function fail(error: string): never {
  process.stdout.write(JSON.stringify({ ok: false, error }));
  process.exit(1);
}

if (!dbFile) fail('体检子进程缺少 MC_HEALTH_DB');

try {
  const db = new Db(dbFile, { readOnly: true });
  try {
    const payload = computeGlobalHealthPayload(db, limit);
    process.stdout.write(JSON.stringify({ ok: true, payload }));
  } finally {
    db.close();
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
