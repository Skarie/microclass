/**
 * 迁移执行器：按文件名顺序执行 db/migrations/*.sql，未执行过的才执行；
 * 每次记录版本、校验和与耗时，支持“同一版本内容被篡改”检测。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './client.js';

export interface MigrationFile {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: number;
  duration_ms: number;
}

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);`;

export function loadMigrations(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const file = path.join(dir, f);
      const sql = fs.readFileSync(file, 'utf8');
      const m = /^(\d+)[-_](.+)\.sql$/.exec(f);
      return {
        version: m?.[1] ?? f,
        name: m?.[2] ?? f,
        file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

export function appliedMigrations(db: Db): AppliedMigration[] {
  db.exec(MIGRATION_TABLE);
  return db.all<AppliedMigration>('SELECT * FROM schema_migrations ORDER BY version');
}

export interface MigrateResult {
  applied: MigrationFile[];
  skipped: MigrationFile[];
  durationMs: number;
}

export function runMigrations(db: Db, dir: string): MigrateResult {
  const started = Date.now();
  db.exec(MIGRATION_TABLE);
  const done = new Map(appliedMigrations(db).map((m) => [m.version, m]));
  const migrations = loadMigrations(dir);
  const applied: MigrationFile[] = [];
  const skipped: MigrationFile[] = [];

  for (const m of migrations) {
    const prev = done.get(m.version);
    if (prev) {
      if (prev.checksum !== m.checksum) {
        throw new Error(`迁移 ${m.version}_${m.name} 内容已被修改（校验和不一致），请新增迁移而不是修改历史迁移`);
      }
      skipped.push(m);
      continue;
    }
    const t0 = Date.now();
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, checksum, applied_at, duration_ms) VALUES (?,?,?,?,?)', [
        m.version,
        m.name,
        m.checksum,
        Math.floor(Date.now() / 1000),
        Date.now() - t0,
      ]);
    });
    applied.push(m);
  }

  return { applied, skipped, durationMs: Date.now() - started };
}
