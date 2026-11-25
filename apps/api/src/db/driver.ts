/**
 * 数据层驱动选择（P0 阶段 2 的装配入口）。
 *
 * - 默认 `MC_DB=sqlite`：把现有同步 `Db` 包成 `AsyncDb`，行为与迁移前完全一致；
 * - `MC_DB=pg`：建 PG 连接池（不支持"半连接"——建池不连库，首次查询才连）。
 *
 * 迁移期间两种驱动并存：已迁移的域用 `asyncDb`，未迁移的域继续用 `db`。
 * **同一请求内不能跨库事务**（sqlite 与 pg 是两个库），需要跨域的写操作要等该批域全部迁完。
 */
import type { AppConfig } from '../config/env.js';
import type { Db } from './client.js';
import { createPgAsyncDb, createSqliteAsyncDb, type AsyncDb } from './async.js';
import { createPgPool, describePgUrl } from './pg/pool.js';

export interface DatabaseHandles {
  /** 已迁移域使用的异步端口 */
  asyncDb: AsyncDb;
  /** 打日志用：绝不包含密码 */
  describe: string;
}

export function createDatabaseHandles(config: AppConfig, sqliteDb: Db): DatabaseHandles {
  if (config.dbDriver === 'pg') {
    if (!config.pgUrl) {
      throw new Error('MC_DB=pg 时必须设置 MC_PG_URL（postgres://user:pass@host:port/db）');
    }
    return {
      asyncDb: createPgAsyncDb(createPgPool({ url: config.pgUrl })),
      describe: `pg ${describePgUrl(config.pgUrl)}`,
    };
  }
  return { asyncDb: createSqliteAsyncDb(sqliteDb), describe: 'sqlite' };
}

/**
 * 进程级单例：已迁移的域通过它拿 `AsyncDb`。
 *
 * 为什么不做成 Deps 字段：`app.ts` 已到文件行数守卫的基线，不能再长；
 * 而且一个进程本来就只该有一个连接池，单例比到处构造更安全（PG 连接数有限）。
 *
 * 缓存里记着「是哪个 sqlite Db 包出来的」：测试会为每个用例新建 `:memory:` 库，
 * 若沿用旧句柄就会 `database is not open`，所以底层 Db 变了就重建（PG 模式同理换池）。
 */
let cached: (DatabaseHandles & { source: Db }) | null = null;

export function getAsyncDb(config: AppConfig, sqliteDb: Db): AsyncDb {
  if (!cached || cached.source !== sqliteDb) {
    cached = { ...createDatabaseHandles(config, sqliteDb), source: sqliteDb };
  }
  return cached.asyncDb;
}

/** 测试用：丢掉缓存的句柄（不影响已关闭的底层连接） */
export function resetAsyncDbCache(): void {
  cached = null;
}

/** 打日志用（不含密码）；未初始化时返回 sqlite */
export function describeDatabase(config: AppConfig): string {
  return cached?.describe ?? (config.dbDriver === 'pg' ? 'pg(未初始化)' : 'sqlite');
}
