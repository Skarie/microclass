/**
 * 审计日志仓储：所有管理端写操作都应落一条。
 */
import type { Db } from '../client.js';

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
  constructor(private readonly db: Db) {}

  write(input: AuditInput): void {
    this.db.run(
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
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 200);
      this.flushTimer.unref?.();
    }
  }
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      this.db.transaction(() => {
        for (const item of batch) this.write(item);
      });
    } catch {
      // 审计失败不影响主流程，丢弃这一批
    }
  }

  recent(limit = 100): unknown[] {
    return this.db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  }
}
