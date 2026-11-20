/**
 * 体检计算 worker（迁移 0031）：在独立线程里扫全库，主线程不阻塞。
 *
 * 连接是**只读**的（自己一条 SQLite 连接）：worker 不会写库，
 * 结果通过 postMessage 交给主线程，由主线程写 `bank_health_cache`。
 *
 * 输出约定：`{ ok: true, payload }` 或 `{ ok: false, error }`（绝不抛到线程外）。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { Db } from '../db/client.js';
import { computeGlobalHealthPayload } from '../db/repositories/bankHealthPayload.js';

interface HealthWorkerData {
  dbFile: string;
  limit: number;
}

const { dbFile, limit } = workerData as HealthWorkerData;

try {
  const db = new Db(dbFile, { readOnly: true });
  try {
    const payload = computeGlobalHealthPayload(db, limit);
    parentPort?.postMessage({ ok: true, payload });
  } finally {
    db.close();
  }
} catch (e) {
  parentPort?.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
}
