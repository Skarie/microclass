/**
 * 体检协调器（迁移 0031）：**不再在主线程同步扫库**，改成「持久缓存 + 后台 worker + 202」。
 *
 * 语义（接口契约）：
 *   - 缓存未过期（TTL 24h）→ 直接返回 ready 全量结果；
 *   - 无缓存 / 已过期 / 显式 refresh → 触发一次 worker（同一时刻只允许一个），**立即返回 202**
 *     `{ status:'computing', startedAt, retryAfterMs }`，不阻塞请求；
 *   - `status()` 是轻量查询（不扫库），前端据此 3 秒轮询。
 *
 * 为什么需要「同一时刻只跑一个」：worker 本身很重（扫几十万题），并发触发只会把 NAS 磁盘打满。
 * `runner` 可注入：生产是 worker_threads，测试用进程内实现，便于断言并发与落库。
 */
import type { BankHealthCacheRepository } from '../db/repositories/bankHealthCacheRepository.js';
import type { BankHealthPayload } from '../db/repositories/bankHealthPayload.js';
import type { BankHealthRunner } from './bankHealthRunner.js';

/** 体检结果有效期：全库聚合很贵，一天一次足够（老师需要最新时点「重新体检」） */
export const HEALTH_TTL_MS = 24 * 60 * 60 * 1000;
/** 202 里告诉前端多久后再轮询（毫秒） */
export const HEALTH_RETRY_AFTER_MS = 3000;
/** 算全库体检时给重复题明细的条数（与旧预热一致） */
export const HEALTH_WORKER_LIMIT = 20;

export interface HealthReadyResponse extends BankHealthPayload {
  status: 'ready';
  /** 结果写入缓存的时间（毫秒时间戳，前端显示「缓存于 HH:MM:SS」） */
  cachedAt: number;
  /**
   * 缓存已过期但自动体检关闭（`MC_HEALTH_AUTO=0`）时置为 true：
   * 返回的是旧结果，管理端应提示「数据较旧，可手动重新体检」。
   */
  stale?: boolean;
}

export interface HealthComputingResponse {
  status: 'computing';
  startedAt: number;
  retryAfterMs: number;
}

export type HealthResponse = HealthReadyResponse | HealthComputingResponse;

export interface HealthStatusResponse {
  status: 'ready' | 'computing' | 'stale';
  /** 缓存时间（有缓存时返回） */
  computedAt?: number;
  /** 本次计算开始时间（computing 时返回） */
  startedAt?: number;
  /** 最近一次计算失败的原因（失败过才返回） */
  error?: string;
}

interface CacheSnapshot {
  payload: BankHealthPayload;
  computedAtMs: number;
}

export class BankHealthCoordinator {
  /** 可注入：测试替换为进程内 runner / 假 runner */
  runner: BankHealthRunner;

  private running = false;
  private startedAt = 0;
  private lastError: string | null = null;
  private current: Promise<void> | null = null;

  constructor(
    private readonly cache: BankHealthCacheRepository,
    runner: BankHealthRunner,
    private readonly ttlMs: number = HEALTH_TTL_MS,
    private readonly now: () => number = Date.now,
    /**
     * 是否允许「自动」体检（启动预热 + 缓存过期时自动重算）。
     *
     * 生产默认关闭（`config.autoBankHealth`，来自 `MC_HEALTH_AUTO`，默认 0）：
     * 全库扫描在机械盘上是重度 IO，曾把事件循环拖死。关掉后只有
     * `refresh=1`（管理端「重新体检」）才会真正计算。
     * 构造函数默认 true，保持单测里「过期即自动算」的既有语义。
     */
    private readonly auto: boolean = true,
  ) {
    this.runner = runner;
  }

  /** 接口主入口：ready 直接返回结果；否则触发后台计算并返回 202 契约 */
  async get(options?: { refresh?: boolean }): Promise<HealthResponse> {
    const snapshot = await this.snapshot();
    if (!options?.refresh && snapshot && this.isFresh(snapshot)) {
      return { status: 'ready', ...snapshot.payload, cachedAt: snapshot.computedAtMs };
    }
    // 自动体检关闭 + 有过期缓存：直接给旧结果并标记 stale，绝不偷偷起 worker
    if (!options?.refresh && !this.auto && snapshot) {
      return { status: 'ready', stale: true, ...snapshot.payload, cachedAt: snapshot.computedAtMs };
    }
    this.start();
    return { status: 'computing', startedAt: this.startedAt, retryAfterMs: HEALTH_RETRY_AFTER_MS };
  }

  /** 轻量状态查询（不扫库）：ready / computing / stale */
  async status(): Promise<HealthStatusResponse> {
    const snapshot = await this.snapshot();
    if (this.running) {
      return {
        status: 'computing',
        startedAt: this.startedAt,
        ...(snapshot ? { computedAt: snapshot.computedAtMs } : {}),
        ...(this.lastError ? { error: this.lastError } : {}),
      };
    }
    if (snapshot && this.isFresh(snapshot)) {
      return { status: 'ready', computedAt: snapshot.computedAtMs };
    }
    return {
      status: 'stale',
      ...(snapshot ? { computedAt: snapshot.computedAtMs } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  /** 启动预热用：缓存过期才在后台算一次（绝不阻塞启动）；自动体检关闭时什么都不做 */
  async ensureFresh(): Promise<void> {
    if (!this.auto) return;
    const snapshot = await this.snapshot();
    if (snapshot && this.isFresh(snapshot)) return;
    this.start();
  }

  /** 等当前这次计算结束（测试 / 优雅关闭用；没有在算就立即 resolve） */
  whenIdle(): Promise<void> {
    return this.current ?? Promise.resolve();
  }

  /** 当前是否正在计算 */
  isComputing(): boolean {
    return this.running;
  }

  private isFresh(snapshot: CacheSnapshot): boolean {
    return this.now() - snapshot.computedAtMs < this.ttlMs;
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
    this.lastError = null;
    const run = this.runner(HEALTH_WORKER_LIMIT)
      .then(async (payload) => {
        await this.cache.save(new Date(this.now()).toISOString(), JSON.stringify(payload));
        // 体检期间 worker 长期只读，checkpoint 推不动；算完主动收一次 WAL（PG 模式为空操作）
        await this.cache.checkpoint();
      })
      .catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        this.running = false;
        this.current = null;
      });
    this.current = run;
  }

  private async snapshot(): Promise<CacheSnapshot | null> {
    try {
      const row = await this.cache.get();
      if (!row) return null;
      const ms = Date.parse(row.computed_at);
      return {
        payload: JSON.parse(row.payload) as BankHealthPayload,
        computedAtMs: Number.isFinite(ms) ? ms : 0,
      };
    } catch {
      // 缓存行损坏（手工改库 / 迁移中途）：当作没有缓存，重新算
      return null;
    }
  }
}
