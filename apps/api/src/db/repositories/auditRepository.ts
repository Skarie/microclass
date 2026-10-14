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

  recent(limit = 100): unknown[] {
    return this.db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
  }
}
