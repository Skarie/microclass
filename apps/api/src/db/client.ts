/**
 * SQLite 连接与访问层（node:sqlite，零外部依赖）。
 * 只做连接与语句执行，不含业务逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

export class Db {
  readonly handle: DatabaseSync;
  /**
   * 预编译语句缓存。
   * node:sqlite 的 prepare 每次都要编译 SQL，N150 这种低功耗 CPU 上单条约 0.3~1ms；
   * 一次请求要跑 4~6 条语句，光编译就占了大半。缓存后同样的 SQL 只编译一次。
   * 上限 400 条，超了整体清空（动态拼 IN 的语句不常复用，清掉也不亏）。
   */
  private readonly stmtCache = new Map<string, StatementSync>();
  private stmt(sql: string): StatementSync {
    const hit = this.stmtCache.get(sql);
    if (hit) return hit;
    const prepared = this.handle.prepare(sql);
    if (this.stmtCache.size >= 400) this.stmtCache.clear();
    this.stmtCache.set(sql, prepared);
    return prepared;
  }

  constructor(file: string) {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.handle = new DatabaseSync(file);
    this.handle.exec('PRAGMA journal_mode = WAL;');
    this.handle.exec('PRAGMA foreign_keys = ON;');
    this.handle.exec('PRAGMA busy_timeout = 5000;');
    /**
     * WAL 下默认 synchronous=FULL（每次提交都 fsync）。本平台跑在 NAS 上，
     * 写操作（导入/组卷/删除）会因此明显变慢；NORMAL 是 WAL 的推荐搭配，
     * 崩溃时最多丢最后一个事务，数据库本身保持一致。
     */
    this.handle.exec('PRAGMA synchronous = NORMAL;');
    // 题库全量导入后库有几百 MB，且常常落在 NAS 机械盘上：
    // 把排序/分组用的临时表放进内存、缓存与 mmap 调大，避免体检这类聚合查询把磁盘打满。
    this.handle.exec('PRAGMA temp_store = MEMORY;');
    this.handle.exec('PRAGMA cache_size = -65536;'); // ≈64MB 页缓存
    if (file !== ':memory:') {
      try {
        this.handle.exec('PRAGMA mmap_size = 268435456;'); // 256MB
      } catch {
        /* 某些平台不支持 mmap，忽略 */
      }
    }
    /**
     * WAL 文件在 checkpoint 之后**不会自动缩小**，只会复用；长期运行会留下一个
     * 几百 MB 的 -wal 文件（生产上见过 549MB）。设上限后，超过就截断。
     */
    if (file !== ':memory:') {
      try {
        this.handle.exec('PRAGMA journal_size_limit = 67108864;'); // 64MB
      } catch {
        /* 老版本 SQLite 无此参数，忽略 */
      }
    }
  }

  /** 主动做一次 WAL checkpoint（周期任务调用，避免 -wal 长期不缩） */
  checkpoint(): { busy: number; log: number; checkpointed: number } {
    const row = this.handle.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
      { busy: number; log: number; checkpointed: number } | undefined;
    return row ?? { busy: 0, log: 0, checkpointed: 0 };
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    const info = this.stmt(sql).run(...(params as never[]));
    return {
      changes: Number(info.changes ?? 0),
      lastInsertRowid: Number(info.lastInsertRowid ?? 0),
    };
  }

  get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.stmt(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.stmt(sql).all(...(params as never[])) as T[];
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.handle.exec('BEGIN');
    try {
      const out = fn();
      this.handle.exec('COMMIT');
      return out;
    } catch (e) {
      this.handle.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.stmtCache.clear();
    this.handle.close();
  }
}

/** 打开数据库（dataDir 下的 microclass.db） */
export function openDb(dataDir: string, file = 'microclass.db'): Db {
  return new Db(path.join(dataDir, file));
}
