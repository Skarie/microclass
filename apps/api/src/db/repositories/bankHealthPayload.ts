/**
 * 全库体检 payload 的**唯一计算入口**（迁移 0031）。
 *
 * 为什么单独抽出来：同一段聚合要被两处调用 ——
 *   1. worker 线程（生产：自己的只读 SQLite 连接，主线程不被阻塞）；
 *   2. 进程内 runner（测试 / 无 worker 环境：直接在主线程算，用于单测与本地小库）。
 * 两处必须产生**完全相同**的 JSON，否则「worker 结果落库」和「接口返回」会不一致。
 *
 * 只依赖 `Db` 与仓储，不依赖 Fastify / 配置 / 审计，因此 worker 里可以直接 import。
 *
 * P0 阶段 2（questions 读批次）：questions 的读写统一走注入的 `AsyncDb`
 * （worker 里按 `MC_DB` 建只读 PG 连接 / sqlite 包装）——「只补 DI 不改读方法」或反之
 * 都会造成跨库混合读写，所以这里的仓储必须拿到同一个 `asyncDb`。
 */
import type { Db } from '../client.js';
import type { AsyncDb } from '../async.js';
import { BankRepository } from './bankRepository.js';
import { QuestionRepository } from './questionRepository.js';
import type { SettingsRepository } from './settingsRepository.js';
import { difficultyStats } from './question-stats.js';
import { DIFFICULTY_CUTS_KEY, parseDifficultyCuts } from '../../domain/difficultyCuts.js';
import type { BankHealthResult } from '../../services/bankHealthService.js';

/** 落库 / 返回的 payload（不含 cachedAt：那是由缓存时间算出来的） */
export type BankHealthPayload = Omit<BankHealthResult, 'cachedAt'>;

/** 计算全库体检（大库很慢，必须只在 worker / 子进程 / 测试里调用） */
export async function computeGlobalHealthPayload(
  db: Db,
  asyncDb: AsyncDb,
  settings: SettingsRepository,
  limit: number,
): Promise<BankHealthPayload> {
  const questions = new QuestionRepository(db, asyncDb);
  const banks = new BankRepository(db, asyncDb);

  const stats = await questions.health(undefined);
  return {
    scope: { bankId: null, name: '全库' },
    stats,
    metadata: {
      withSubject: await questions.countByMeta(undefined, 'subject', stats.total),
      withBook: await questions.countByMeta(undefined, 'book', stats.total),
      withPoint: await questions.countByMeta(undefined, 'point', stats.total),
      withHash: await questions.countByMeta(undefined, 'content_hash', stats.total),
    },
    duplicates: await questions.duplicateGroups(limit),
    kinds: await banks.kindStats(),
    difficulty: await difficultyStats(asyncDb, undefined, parseDifficultyCuts(settings.getSync(DIFFICULTY_CUTS_KEY))),
  };
}
