/**
 * 异步数据库端口（P0 阶段 2 的地基）。
 *
 * 为什么需要：SQLite 用 `node:sqlite` 的同步 API，PostgreSQL 的驱动天然异步。
 * 要让两种驱动共用同一套 service/repository，对外必须是**异步**接口。
 *
 * 设计要点：
 *   - SQLite 实现把同步调用包一层 Promise（行为与今天完全一致，仍是默认路径）；
 *   - PG 实现用连接池，并把 `?` 占位符重写成 `$1..$n`，这样 repository 里的 SQL
 *     不用为了迁移重写（只认 `?`）；
 *   - `transaction()` 保证同一事务走同一连接（PG 里尤其重要）。
 */
import type { Db } from './client.js';

export type DbRow = Record<string, unknown>;
export type DbDriverName = 'sqlite' | 'pg';

export interface AsyncDb {
  readonly driver: DbDriverName;
  all<T = DbRow>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = DbRow>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** 事务：回调里的语句共用同一连接；抛错自动回滚 */
  transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** 把 `?` 占位符换成 PG 的 `$n`；跳过单引号字符串里的问号 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let index = 1;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      // 处理 '' 转义
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }
    if (ch === '?' && !inString) {
      out += `$${index}`;
      index += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** SQLite 实现：包装现有同步 Db，行为不变 */
class SqliteAsyncDb implements AsyncDb {
  readonly driver = 'sqlite' as const;

  constructor(private readonly db: Db) {}

  async all<T = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.all<T>(sql, params);
  }

  async get<T = DbRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.get<T>(sql, params);
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    return { changes: this.db.run(sql, params).changes };
  }

  async transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T> {
    this.db.run('BEGIN IMMEDIATE');
    try {
      const result = await fn(this);
      this.db.run('COMMIT');
      return result;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  /**
   * 不关闭连接：sqlite 的 `Db` 由调用方（app / 子进程）持有并负责关闭。
   * 若这里也 close，调用方再 close 就会抛 `database is not open`。
   */
  async close(): Promise<void> {
    /* no-op：所有权在调用方 */
  }
}

export function createSqliteAsyncDb(db: Db): AsyncDb {
  return new SqliteAsyncDb(db);
}

/** 最小化的 PG 池接口（避免把 pg 的类型泄漏到业务层） */
export interface PgPoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: DbRow[]; rowCount: number | null }>;
  connect(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: DbRow[]; rowCount: number | null }>;
    release(): void;
  }>;
  end(): Promise<void>;
}

class PgAsyncDb implements AsyncDb {
  readonly driver = 'pg' as const;

  constructor(private readonly pool: PgPoolLike) {}

  async all<T = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(toPgPlaceholders(sql), params);
    return res.rows as T[];
  }

  async get<T = DbRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.pool.query(toPgPlaceholders(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let release = true;
    try {
      await client.query('BEGIN');
      const result = await fn(new PgClientAsyncDb(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* 回滚失败（连接已断）时交给连接池丢弃该连接 */
      }
      throw e;
    } finally {
      if (release) client.release();
      release = false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** 事务内的 PG 连接（不自己开事务、不自己释放） */
class PgClientAsyncDb implements AsyncDb {
  readonly driver = 'pg' as const;

  constructor(
    private readonly client: {
      query(sql: string, params?: unknown[]): Promise<{ rows: DbRow[]; rowCount: number | null }>;
    },
  ) {}

  async all<T = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(toPgPlaceholders(sql), params);
    return res.rows as T[];
  }

  async get<T = DbRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.client.query(toPgPlaceholders(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T> {
    // 嵌套事务暂不支持：调用方应把逻辑合到外层事务里
    return fn(this);
  }

  async close(): Promise<void> {
    /* 由外层事务释放 */
  }
}

export function createPgAsyncDb(pool: PgPoolLike): AsyncDb {
  return new PgAsyncDb(pool);
}
