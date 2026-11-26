/**
 * 体检结果持久缓存（迁移 0031）：单行表，进程重启后仍能秒回。
 *
 * 只需要「读当前快照 / 覆盖写当前快照」两个动作；TTL 判断在服务层做，
 * 这样以后想改过期策略（比如按库大小动态调）不用动 SQL。
 *
 * 走 `AsyncDb`：切流后缓存与业务同库（PG），不再往历史 SQLite 归档里写。
 * `checkpoint()` 是 SQLite 专有（WAL 回收），PG 模式下直接跳过。
 */
import type { AsyncDb } from '../async.js';

export interface BankHealthCacheRow {
  computed_at: string;
  payload: string;
}

export class BankHealthCacheRepository {
  constructor(private readonly asyncDb: AsyncDb) {}

  /** 当前快照（没有则 undefined） */
  async get(): Promise<BankHealthCacheRow | undefined> {
    return this.asyncDb.get<BankHealthCacheRow>('SELECT computed_at, payload FROM bank_health_cache WHERE id = 1');
  }

  /** 覆盖写当前快照（单行表，永远 id=1） */
  async save(computedAt: string, payloadJson: string): Promise<void> {
    await this.asyncDb.run(
      `INSERT INTO bank_health_cache (id, computed_at, payload) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET computed_at = excluded.computed_at, payload = excluded.payload`,
      [computedAt, payloadJson],
    );
  }

  /**
   * 体检结束后主动把 WAL 收回去（尽力而为）。
   *
   * 体检 worker 会长时间只读同一份库，期间 checkpoint 推不动、WAL 只涨不落；
   * 写完缓存后显式 TRUNCATE 一次，避免下一次写请求被大 WAL 拖慢。
   * PG 没有 WAL 文件概念（也不需要这里回收），直接返回。
   */
  async checkpoint(): Promise<void> {
    if (this.asyncDb.driver !== 'sqlite') return;
    try {
      await this.asyncDb.run('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* 有长读者时 checkpoint 可能失败：忽略，交给 SQLite 自动 checkpoint */
    }
  }
}
