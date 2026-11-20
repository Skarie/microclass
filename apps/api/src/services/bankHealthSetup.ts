/**
 * 体检协调器的装配（迁移 0031）。
 *
 * 单独成文件的原因：`app.ts` 已在文件行数守卫的技术债基线里（只能减不能增），
 * 把「缓存仓储 + runner（worker / 进程内）+ 协调器」这三步装配抽出来，
 * app.ts 里只保留一行创建。
 */
import path from 'node:path';
import type { Db } from '../db/client.js';
import { BankHealthCacheRepository } from '../db/repositories/bankHealthCacheRepository.js';
import { BankHealthCoordinator } from './bankHealthCoordinator.js';
import { createInlineHealthRunner, createWorkerHealthRunner } from './bankHealthRunner.js';

export interface CreateBankHealthOptions {
  /** 测试注入内存库时用进程内 runner（不用起 worker 线程） */
  inline?: boolean;
}

/** 创建全库体检协调器：生产用 worker 线程（只读连接），测试用进程内 runner */
export function createBankHealthCoordinator(
  db: Db,
  dataDir: string,
  options?: CreateBankHealthOptions,
): BankHealthCoordinator {
  const runner = options?.inline
    ? createInlineHealthRunner(db)
    : createWorkerHealthRunner(path.join(dataDir, 'microclass.db'));
  return new BankHealthCoordinator(new BankHealthCacheRepository(db), runner);
}
