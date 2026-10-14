/**
 * SQLite 连接与访问层（node:sqlite，零外部依赖）。
 * 只做连接与语句执行，不含业务逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

export class Db {
  readonly handle: DatabaseSync;

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
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number } {
    const info = this.handle.prepare(sql).run(...(params as never[]));
    return {
      changes: Number(info.changes ?? 0),
      lastInsertRowid: Number(info.lastInsertRowid ?? 0),
    };
  }

  get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
    return this.handle.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params: unknown[] = []): T[] {
    return this.handle.prepare(sql).all(...(params as never[])) as T[];
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
    this.handle.close();
  }
}

/** 打开数据库（dataDir 下的 microclass.db） */
export function openDb(dataDir: string, file = 'microclass.db'): Db {
  return new Db(path.join(dataDir, file));
}
