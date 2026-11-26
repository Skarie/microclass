/**
 * 审计日志仓储：所有管理端写操作都应落一条。
 *
 * 走 `AsyncDb`（PG 模式下审计与业务同库）：切流后审计不能继续写 SQLite，
 * 否则「业务在 PG、审计在 SQLite」，查审计要翻两个库。
 *
 * 两条写路径：
 *   - `write()`：普通管理写操作，调用方 `await`（失败会让请求 500，与迁移前同步写一致）；
 *   - `writeBuffered()`：交卷这类高并发写，攒 200ms / 50 条一次事务提交，仍然「审计失败不影响主流程」。
 */
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';

export interface AuditInput {
  actorId?: number | null;
  actorName?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  detail?: unknown;
  ip?: string;
  requestId?: string;
}

export class AuditRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async write(input: AuditInput): Promise<void> {
    await this.insert(this.adb(), input);
  }

  private async insert(db: AsyncDb, input: AuditInput): Promise<void> {
    await db.run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip, request_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        input.actorId ?? null,
        input.actorName ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId === undefined ? null : String(input.targetId),
        input.detail === undefined ? null : JSON.stringify(input.detail),
        input.ip ?? null,
        input.requestId ?? null,
      ],
    );
  }

  /**
   * 缓冲写审计日志：并发交卷时每次提交都要写一条审计，和成绩写入抢同一把写锁。
   * 审计允许毫秒级延迟，攒 200ms 或攒满 50 条再一次性事务提交（只付一次提交成本）。
   */
  private buffer: AuditInput[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  writeBuffered(input: AuditInput): void {
    this.buffer.push(input);
    if (this.buffer.length >= 50) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, 200);
      this.flushTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.adb().transaction(async (tx) => {
        for (const item of batch) await this.insert(tx, item);
      });
    } catch {
      // 审计失败不影响主流程，丢弃这一批
    }
  }

  async recent(limit = 100): Promise<unknown[]> {
    return this.adb().all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  }
}
