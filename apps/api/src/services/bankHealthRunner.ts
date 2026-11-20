/**
 * 体检计算 runner：把「算全库体检」这件事交给独立 worker 线程。
 *
 * 生产用 `createWorkerHealthRunner(dbFile)`：worker 自己开**只读** SQLite 连接扫库，
 * 主线程只等 postMessage，事件循环不被占住（这是修「冷缓存 6.5 分钟全站卡死」的关键）。
 *
 * 测试/本地小库用 `createInlineHealthRunner(db)`：同一段聚合在主线程算，
 * 但 API 语义（202 → ready）与生产完全一致；runner 可注入，便于单测并发与落库。
 */
import { Worker } from 'node:worker_threads';
import type { Db } from '../db/client.js';
import { computeGlobalHealthPayload, type BankHealthPayload } from '../db/repositories/bankHealthPayload.js';

/** 一次体检计算（异步：生产走 worker，测试可替换） */
export type BankHealthRunner = (limit: number) => Promise<BankHealthPayload>;

interface WorkerMessage {
  ok: boolean;
  payload?: BankHealthPayload;
  error?: string;
}

/** 生产 runner：单独线程 + 只读连接；同一时刻只有一个 worker（由协调器保证） */
export function createWorkerHealthRunner(dbFile: string): BankHealthRunner {
  return (limit) =>
    new Promise<BankHealthPayload>((resolve, reject) => {
      // 编译产物里本文件在 dist/services/，worker 在 dist/workers/
      const worker = new Worker(new URL('../workers/bankHealthWorker.js', import.meta.url), {
        workerData: { dbFile, limit },
      });
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        void worker.terminate();
        fn();
      };
      worker.once('message', (message: WorkerMessage) => {
        if (message.ok && message.payload) finish(() => resolve(message.payload as BankHealthPayload));
        else finish(() => reject(new Error(message.error ?? '体检 worker 未返回结果')));
      });
      worker.once('error', (e) => finish(() => reject(e)));
      worker.once('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error(`体检 worker 异常退出（code=${code}）`)));
      });
    });
}

/** 进程内 runner：测试与「无法起线程」的场景（语义与 worker 完全一致） */
export function createInlineHealthRunner(db: Db): BankHealthRunner {
  return (limit) => Promise.resolve().then(() => computeGlobalHealthPayload(db, limit));
}
