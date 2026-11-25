/**
 * 体检协调器的装配（迁移 0031）。
 *
 * 单独成文件的原因：`app.ts` 已在文件行数守卫的技术债基线里（只能减不能增），
 * 把「缓存仓储 + runner（worker / 进程内）+ 协调器」这三步装配抽出来，
 * app.ts 里只保留一行创建。
 */
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { SettingsRepository } from '../db/repositories/settingsRepository.js';
import { BankHealthCacheRepository } from '../db/repositories/bankHealthCacheRepository.js';
import { BankHealthCoordinator } from './bankHealthCoordinator.js';
import { createInlineHealthRunner, createWorkerHealthRunner } from './bankHealthRunner.js';

export interface CreateBankHealthOptions {
  /** 测试注入内存库时用进程内 runner（不用起 worker 进程） */
  inline?: boolean;
}

/**
 * 创建全库体检协调器：生产用独立子进程（只读连接，ionice/nice 降优先级），
 * 测试用进程内 runner。`config.autoBankHealth` 决定是否允许自动重算（默认关）。
 */
export function createBankHealthCoordinator(
  db: Db,
  config: Pick<AppConfig, 'dataDir' | 'autoBankHealth'>,
  settings: SettingsRepository,
  options?: CreateBankHealthOptions,
): BankHealthCoordinator {
  const runner = options?.inline
    ? createInlineHealthRunner(db, settings)
    : createWorkerHealthRunner(path.join(config.dataDir, 'microclass.db'));
  return new BankHealthCoordinator(
    new BankHealthCacheRepository(db),
    runner,
    undefined,
    undefined,
    config.autoBankHealth,
  );
}
