/**
 * PostgreSQL 连接池（P0 阶段 2）。
 *
 * 只在 `MC_DB=pg` 时创建；默认 sqlite 不会加载/连接 PG。
 * 连接参数按「同机容器」场景给：池上限要乘以 API 副本数，别把 PG 的 max_connections 占满。
 */
import { Pool, types } from 'pg';
import type { PgPoolLike } from '../async.js';

/**
 * 方言 #17：int8（`COUNT/SUM/MAX`、`RETURNING id`、`bigint` 列）经 node-postgres 默认回传 **string**，
 * 与 SQLite 的 number 语义不一致（`=== 1`、`+`、排序都会出错）。
 *
 * 在驱动层全局把 OID 20（int8）解析成 number：这是**兜底**，仓储边界该 `Number()` 的地方仍要收敛
 * （本项目 id/计数/Unix 秒都远小于 2^53，不会丢精度）。
 */
types.setTypeParser(20, (value: string) => Number(value));

/**
 * 方言 #17 续（2.4.3，真 PG 套件发现）：`SUM(bigint)` / `AVG(...)` 在 PG 里返回 **numeric（OID 1700）**，
 * node-postgres 默认同样回传 string —— `/banks/catalog` 的 `questionCount` 实测是 `"2068"` 而不是 `2068`，
 * 前端累加会变字符串拼接。本库没有 `numeric` 列（INTEGER→bigint、REAL→double precision、TEXT→text），
 * numeric 只来自这些聚合（题量/观看秒数/得分等，远小于 2^53），因此统一转 number 与 SQLite 语义对齐。
 */
types.setTypeParser(1700, (value: string) => Number(value));

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
