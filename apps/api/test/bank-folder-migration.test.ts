/**
 * 迁移 0024：历史 `banks.book / section` → 两级文件夹。
 *
 * 单独在临时目录里「先跑到 0023 → 造历史数据 → 再应用 0024」，
 * 这样能验证数据回填本身，而不是只验证全新库的表结构。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';

interface FolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
}

interface BankFolderRow {
  id: number;
  book: string;
  section: string;
  folder_id: number | null;
}

const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');
const allFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function copyMigrations(dir: string, maxVersion: number): void {
  for (const file of allFiles) {
    if (Number(file.slice(0, 4)) <= maxVersion) fs.copyFileSync(path.join(migrationsDir, file), path.join(dir, file));
  }
}

describe('迁移 0024：book/section 转文件夹', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bank-folders-mig-'));
    db = new Db(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(): void {
    const rows: [string, string, string, number][] = [
      ['b1', '初中七年级数学', '第一章', 2],
      ['b2', '初中七年级数学', '第一章', 3],
      ['b3', '初中七年级数学', '', 4],
      ['b4', '必刷题', '1.11', 5],
      ['b5', '必刷题', '', 6],
      ['b6', '', '第一章', 7],
      ['b7', '', '', 8],
      ['b8', '必刷题', '第一章', 9],
    ];
    for (const [name, book, section, questionCount] of rows) {
      db.run('INSERT INTO banks (name, book, section, question_count) VALUES (?,?,?,?)', [
        name,
        book,
        section,
        questionCount,
      ]);
    }
  }

  function folders(): FolderRow[] {
    return db.all<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders ORDER BY sort, id');
  }

  function bankRows(): BankFolderRow[] {
    return db.all<BankFolderRow>('SELECT id, book, section, folder_id FROM banks ORDER BY id');
  }

  function folderPath(folderId: number | null): string {
    if (folderId === null) return '';
    const row = db.get<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders WHERE id = ?', [folderId]);
    if (!row) return '(missing)';
    const parent =
      row.parent_id === null
        ? undefined
        : db.get<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders WHERE id = ?', [row.parent_id]);
    return parent ? `${parent.name} / ${row.name}` : row.name;
  }

  it('每个非空 book 建顶层、非空 section 建子层，并回填 folder_id', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    seed();
    copyMigrations(dir, 24);
    const result = runMigrations(db, dir);

    expect(result.applied.map((m) => m.version)).toEqual(['0024']);
    expect(
      folders()
        .filter((f) => f.parent_id === null)
        .map((f) => f.name),
    ).toEqual(['初中七年级数学', '必刷题']);
    expect(folders()).toHaveLength(5);

    const rows = bankRows();
    expect(rows.map((r) => folderPath(r.folder_id))).toEqual([
      '初中七年级数学 / 第一章',
      '初中七年级数学 / 第一章',
      '初中七年级数学',
      '必刷题 / 1.11',
      '必刷题',
      '',
      '',
      '必刷题 / 第一章',
    ]);
    // book / section 列保留兼容，不因迁移被清空
    expect(rows[0]).toMatchObject({ book: '初中七年级数学', section: '第一章' });
  });

  it('book 为空（含纯空白）的题库保持未分类，即使 section 有值', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    db.run("INSERT INTO banks (name, book, section) VALUES ('x', '   ', '第一章')");
    copyMigrations(dir, 24);
    runMigrations(db, dir);

    expect(folders()).toHaveLength(0);
    expect(bankRows()[0]?.folder_id).toBeNull();
  });

  it('重复执行迁移不会重复建文件夹（schema_migrations 保证只跑一次）', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    seed();
    copyMigrations(dir, 24);
    runMigrations(db, dir);
    const before = folders();

    const again = runMigrations(db, dir);
    expect(again.applied).toHaveLength(0);
    expect(folders()).toEqual(before);
  });
});
