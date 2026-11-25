/**
 * PostgreSQL 连接池（P0 阶段 2）。
 *
 * 只在 `MC_DB=pg` 时创建；默认 sqlite 不会加载/连接 PG。
 * 连接参数按「同机容器」场景给：池上限要乘以 API 副本数，别把 PG 的 max_connections 占满。
 */
import { Pool } from 'pg';
import type { PgPoolLike } from '../async.js';

export interface PgPoolConfig {
  /** postgres://user:pass@host:port/db（**含密码，禁止打日志**） */
  url: string;
  /** 单进程连接上限，默认 10 */
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/** 把连接串降级成可安全打日志的形式：只保留 host:port/db */
export function describePgUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(invalid pg url)';
  }
}

export function createPgPool(config: PgPoolConfig): PgPoolLike {
  const pool = new Pool({
    connectionString: config.url,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
    application_name: 'microclass-api',
  });
  // 池上未捕获的 idle 连接错误不能把进程带崩
  pool.on('error', (err: Error) => {
    console.error('[pg] idle client error:', err.message);
  });
  return pool;
}
