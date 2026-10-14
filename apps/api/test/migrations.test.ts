import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client.js';
import { loadMigrations, runMigrations } from '../src/db/migrations.js';

describe('数据库迁移', () => {
  let db: Db;
  let dir: string;
  const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-'));
    db = openDb(dir, 'test.db');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('按顺序应用全部迁移并建立基线表', () => {
    const result = runMigrations(db, migrationsDir);
    expect(result.applied.length).toBeGreaterThanOrEqual(2);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    for (const expected of ['users', 'courses', 'lessons', 'questions', 'exams', 'schema_migrations', 'audit_logs']) {
      expect(tables).toContain(expected);
    }
  });

  it('重复执行是幂等的', () => {
    const first = runMigrations(db, migrationsDir);
    const second = runMigrations(db, migrationsDir);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.length).toBe(first.applied.length);
  });

  it('迁移文件命名可被解析出版本号', () => {
    const files = loadMigrations(migrationsDir);
    expect(files[0]?.version).toBe('0001');
    expect(files.every((f) => f.checksum.length === 64)).toBe(true);
  });

  it('检测历史迁移被篡改', () => {
    runMigrations(db, migrationsDir);
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mig-'));
    const first = loadMigrations(migrationsDir)[0];
    fs.writeFileSync(path.join(fakeDir, '0001_x.sql'), `${first?.sql}\n-- tampered`);
    const second = loadMigrations(migrationsDir)[1];
    fs.writeFileSync(path.join(fakeDir, '0002_x.sql'), second?.sql ?? '');
    expect(() => runMigrations(db, fakeDir)).toThrow(/校验和不一致/);
    fs.rmSync(fakeDir, { recursive: true, force: true });
  });
});
