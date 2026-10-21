/**
 * 题库体检与去重：元数据覆盖率、重复题/答案冲突、难度结构统计，以及题库内去重。
 * 全库聚合成本高，体检结果缓存 5 分钟；缓存键与新鲜度判定是纯函数，便于单测。
 */
import { AppError, type User } from '@microclass/shared';
import type { BankRepository } from '../db/repositories/bankRepository.js';
import type { QuestionRepository } from '../db/repositories/questionRepository.js';
import type { AuditRepository } from '../db/repositories/auditRepository.js';
import type { DifficultyService } from './difficultyService.js';

/** 体检结果缓存时长：大库聚合要几秒，5 分钟内复用足够"实时" */
export const HEALTH_CACHE_MS = 5 * 60 * 1000;

/** 缓存键（bankId 为 undefined 表示全库） */
export function healthCacheKey(bankId: number | undefined, limit: number): string {
  return `${bankId ?? 'all'}|${limit}`;
}

/** 缓存是否仍在有效期内（now - at < ttl） */
export function isHealthCacheFresh(at: number, now = Date.now(), ttl = HEALTH_CACHE_MS): boolean {
  return now - at < ttl;
}

interface DuplicateIdGroup {
  hash: string;
  keepId: number;
  removeIds: number[];
}

export interface DedupePlan {
  groups: number;
  removable: number;
  samples: { stem: string; count: number }[];
}

/**
 * 去重计划（纯函数）：把仓储的重复分组折算成「可删数量 + 前 10 组样例」，不落库。
 * 答案冲突的组已由仓储过滤掉，这里不做二次判断。
 */
export function planDedupe(groups: DuplicateIdGroup[], stemOf: (keepId: number) => string): DedupePlan {
  return {
    groups: groups.length,
    removable: groups.reduce((sum, g) => sum + g.removeIds.length, 0),
    samples: groups.slice(0, 10).map((g) => ({
      stem: stemOf(g.keepId).slice(0, 120),
      count: g.removeIds.length + 1,
    })),
  };
}

/** 题库体检结果（缓存与接口共用） */
export interface BankHealthResult {
  scope: { bankId: number | null; name: string };
  stats: ReturnType<QuestionRepository['health']>;
  metadata: { withSubject: number; withBook: number; withPoint: number; withHash: number };
  duplicates: { content_hash: string; n: number; answers: number; stem: string }[];
  kinds: { kind: string; banks: number; questions: number }[];
  /** 难度结构与来源（迁移 0016 的难度模型） */
  difficulty: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    histogram: { bucket: number; questions: number }[];
  };
  cachedAt: number;
}

export class BankHealthService {
  /** 体检结果缓存（key: bankId|limit） */
  private readonly healthCache = new Map<string, { at: number; value: Omit<BankHealthResult, 'cachedAt'> }>();

  constructor(
    private readonly banks: BankRepository,
    private readonly questions: QuestionRepository,
    private readonly difficulty: DifficultyService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * 题库体检（标准化与质量）。
   *
   * 全库体检要扫 36.6 万题（库约 590MB、常在 NAS 机械盘上），因此结果**缓存 5 分钟**：
   * 管理端反复打开/切换时秒回；`refresh: true` 强制重算。
   */
  health(bankId: number | undefined, limit: number, options?: { refresh?: boolean }): BankHealthResult {
    const cacheKey = healthCacheKey(bankId, limit);
    const cached = this.healthCache.get(cacheKey);
    if (!options?.refresh && cached && isHealthCacheFresh(cached.at)) {
      return { ...cached.value, cachedAt: cached.at };
    }
    let name = '全库';
    if (bankId !== undefined) {
      const bank = this.banks.findById(bankId);
      if (!bank) throw AppError.notFound('题库不存在');
      name = bank.name;
    }
    /** 体检的核心统计（全表扫描集中在这里，尽量只算一次） */
    const stats = this.questions.health(bankId);
    const value = {
      scope: { bankId: bankId ?? null, name },
      stats,
      metadata: {
        // 总数已由 stats 算出，传下去避免每个字段再来一次全表 COUNT(*)
        withSubject: this.questions.countByMeta(bankId, 'subject', stats.total),
        withBook: this.questions.countByMeta(bankId, 'book', stats.total),
        withPoint: this.questions.countByMeta(bankId, 'point', stats.total),
        withHash: this.questions.countByMeta(bankId, 'content_hash', stats.total),
      },
      duplicates: this.questions.duplicateGroups(limit, bankId),
      kinds: this.banks.kindStats(),
      difficulty: this.difficulty.stats(bankId),
    };
    const at = Date.now();
    this.healthCache.set(cacheKey, { at, value });
    return { ...value, cachedAt: at };
  }

  /**
   * 题库内去重（标准化）：同一题库里「题干 + 选项」指纹相同、**答案也一致**的题只保留一条。
   * `dryRun`（默认 true）只报告不删；答案冲突的组不动，由体检单独列出。
   */
  dedupeBank(
    actor: User,
    bankId: number,
    options?: { dryRun?: boolean },
  ): {
    dryRun: boolean;
    groups: number;
    removable: number;
    removed: number;
    samples: { stem: string; count: number }[];
  } {
    const bank = this.banks.findById(bankId);
    if (!bank) throw AppError.notFound('题库不存在');
    const groups = this.questions.duplicateIdsInBank(bankId);
    const plan = planDedupe(groups, (keepId) => String(this.questions.findById(keepId)?.stem ?? ''));
    if (options?.dryRun !== false || plan.removable === 0) {
      return { dryRun: true, groups: plan.groups, removable: plan.removable, removed: 0, samples: plan.samples };
    }
    const removed = this.questions.deleteMany(groups.flatMap((g) => g.removeIds));
    this.audit.write({
      actorId: actor.id,
      actorName: actor.username,
      action: 'bank.dedupe',
      targetType: 'bank',
      targetId: bankId,
      detail: { groups: plan.groups, removed },
    });
    return {
      dryRun: false,
      groups: plan.groups,
      removable: plan.removable,
      removed,
      samples: plan.samples,
    };
  }
}
