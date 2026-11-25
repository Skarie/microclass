/**
 * 全库体检 payload 的**唯一计算入口**（迁移 0031）。
 *
 * 为什么单独抽出来：同一段聚合要被两处调用 ——
 *   1. worker 线程（生产：自己的只读 SQLite 连接，主线程不被阻塞）；
 *   2. 进程内 runner（测试 / 无 worker 环境：直接在主线程算，用于单测与本地小库）。
 * 两处必须产生**完全相同**的 JSON，否则「worker 结果落库」和「接口返回」会不一致。
 *
 * 只依赖 `Db` 与仓储，不依赖 Fastify / 配置 / 审计，因此 worker 里可以直接 import。
 */
import type { Db } from '../client.js';
import { BankRepository } from './bankRepository.js';
import { QuestionRepository } from './questionRepository.js';
import type { SettingsRepository } from './settingsRepository.js';
import { difficultyStats } from './question-stats.js';
import { DIFFICULTY_CUTS_KEY, parseDifficultyCuts } from '../../domain/difficultyCuts.js';
import type { BankHealthResult } from '../../services/bankHealthService.js';

/** 落库 / 返回的 payload（不含 cachedAt：那是由缓存时间算出来的） */
export type BankHealthPayload = Omit<BankHealthResult, 'cachedAt'>;

/** 计算全库体检（同步、只读；大库很慢，必须只在 worker 或测试里调用） */
export function computeGlobalHealthPayload(db: Db, settings: SettingsRepository, limit: number): BankHealthPayload {
  const questions = new QuestionRepository(db);
  const banks = new BankRepository(db);

  const stats = questions.health(undefined);
  return {
    scope: { bankId: null, name: '全库' },
    stats,
    metadata: {
      withSubject: questions.countByMeta(undefined, 'subject', stats.total),
      withBook: questions.countByMeta(undefined, 'book', stats.total),
      withPoint: questions.countByMeta(undefined, 'point', stats.total),
      withHash: questions.countByMeta(undefined, 'content_hash', stats.total),
    },
    duplicates: questions.duplicateGroups(limit),
    kinds: banks.kindStats(),
    difficulty: difficultyStats(db, undefined, parseDifficultyCuts(settings.getSync(DIFFICULTY_CUTS_KEY))),
  };
}
