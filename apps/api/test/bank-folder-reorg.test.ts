/**
 * 迁移 0025：目录重组（年级 / 系列 → book → section）与旧 lesson 绑定迁移。
 *
 * 先跑到 0024（已有 book 顶层文件夹），造历史数据，再应用 0025；
 * 并直接重复调用数据钩子验证幂等。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';
import { reorgBankFolders } from '../src/db/bankFolderReorg.js';
import { backfillLegacyLessonLinks } from '../src/db/practiceLinkBackfill.js';

interface FolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
}

interface BankRow {
  id: number;
  folder_id: number | null;
}

interface PracticeLinkRow {
  id: number;
  target_type: string;
  bank_id: number;
  question_id: number | null;
  chapter: string;
  section: string;
}

const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');
const allFiles = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

function copyMigrations(dir: string, maxVersion: number): void {
  for (const file of allFiles) {
    if (Number(file.slice(0, 4)) <= maxVersion) fs.copyFileSync(path.join(migrationsDir, file), path.join(dir, file));
  }
}

describe('迁移 0025：目录重组与课时关联', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-folder-reorg-'));
    db = new Db(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function folders(): FolderRow[] {
    return db.all<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders ORDER BY sort, id');
  }

  function bankRows(): BankRow[] {
    return db.all<BankRow>('SELECT id, folder_id FROM banks ORDER BY id');
  }

  function pathOf(folderId: number | null): string {
    const parts: string[] = [];
    let current = folderId;
    const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const row = db.get<FolderRow>('SELECT id, parent_id, name, sort FROM bank_folders WHERE id = ?', [current]);
      if (!row) return '(missing)';
      parts.unshift(row.name);
      current = row.parent_id;
    }
    return parts.join(' / ');
  }

  function foldersNamed(name: string): FolderRow[] {
    return folders().filter((folder) => folder.name === name);
  }

  function seedCoursesAndLessons(): void {
    db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['初中数学·七年级上册']);
    db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['初中数学·八年级上册']);
    db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (1, ?, 1, ?)', ['七上第一课', '第一章']);
    db.run('INSERT INTO lessons (id, title, course_id, group_name) VALUES (2, ?, 2, ?)', ['八上第一课', '第一章']);
  }

  function seedBanks(): void {
    db.run(
      `INSERT INTO banks (id, name, book, section, course_id, lesson_id, question_count)
       VALUES (1, ?, ?, ?, 1, 1, 3)`,
      ['七上·第一章', '七年级上册', '第一章'],
    );
    db.run(`INSERT INTO banks (id, name, book, section, course_id, question_count) VALUES (2, ?, ?, ?, 1, 2)`, [
      '七上·第二章',
      '七年级上册',
      '第二章',
    ]);
    db.run(`INSERT INTO banks (id, name, book, section, course_id) VALUES (3, ?, '', '', 1)`, ['七上无册次']);
    db.run(`INSERT INTO banks (id, name, book, section, course_id) VALUES (4, ?, ?, ?, 2)`, [
      '八上·第一章',
      '八年级上册',
      '第一章',
    ]);
    db.run(`INSERT INTO banks (id, name, book, section) VALUES (5, ?, ?, ?)`, ['黄冈卷 · 第一章', '黄冈卷', '第一章']);
    db.run(`INSERT INTO banks (id, name, book, section) VALUES (6, ?, ?, '')`, ['必刷题·第一章', '必刷题']);
    db.run(`INSERT INTO banks (id, name, book, section) VALUES (7, ?, '', '')`, ['随堂小测']);
    db.run(`INSERT INTO banks (id, name, book, section) VALUES (8, ?, '', ?)`, ['随堂小测二', '小节A']);
  }

  it('顶层变成年级/系列，book 与 section 层级正确，且旧 lesson 绑定已迁移', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    seedCoursesAndLessons();
    copyMigrations(dir, 24);
    runMigrations(db, dir);
    seedBanks();
    // 0024 之后、0025 之前的老题目：只有 chapter，没有 section
    db.run("INSERT INTO questions (bank_id, type, stem) VALUES (1, 'fill', '旧题')");
    copyMigrations(dir, 25);
    const result = runMigrations(db, dir);
    expect(result.applied.map((m) => m.version)).toEqual(['0025']);

    expect(
      folders()
        .filter((folder) => folder.parent_id === null)
        .map((folder) => folder.name)
        .sort(),
    ).toEqual(['其他资料', '八年级', '七年级', '必刷题', '黄冈'].sort());

    expect(bankRows().map((bank) => pathOf(bank.folder_id))).toEqual([
      '七年级 / 七年级上册 / 第一章',
      '七年级 / 七年级上册 / 第二章',
      '七年级',
      '八年级 / 八年级上册 / 第一章',
      '黄冈 / 黄冈卷 / 第一章',
      '必刷题',
      '其他资料',
      '其他资料 / 小节A',
    ]);
    // 原顶层 book 文件夹是移动进年级，不是复制
    expect(foldersNamed('七年级上册')).toHaveLength(1);
    expect(foldersNamed('七年级上册')[0]?.parent_id).not.toBeNull();

    const link = db.get<PracticeLinkRow>("SELECT * FROM practice_links WHERE target_type = 'bank'");
    expect(link).toMatchObject({ bank_id: 1, question_id: null, chapter: '', section: '' });
    expect(db.all<{ lesson_id: number }>('SELECT lesson_id FROM practice_link_lessons')).toEqual([{ lesson_id: 1 }]);

    const question = db.get<{ chapter: string; section: string }>('SELECT chapter, section FROM questions LIMIT 1');
    expect(question).toEqual({ chapter: '', section: '' });
  });

  it('重复执行数据钩子不重复建文件夹、不改已归位的题库', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    seedCoursesAndLessons();
    copyMigrations(dir, 24);
    runMigrations(db, dir);
    seedBanks();
    copyMigrations(dir, 25);
    runMigrations(db, dir);

    const foldersBefore = folders();
    const banksBefore = bankRows();
    const linksBefore = db.all<PracticeLinkRow>('SELECT * FROM practice_links ORDER BY id');
    const result = reorgBankFolders(db);
    const legacy = backfillLegacyLessonLinks(db);

    expect(result.moved).toBe(0);
    expect(result.created).toBe(0);
    expect(legacy).toEqual({ links: 0, lessons: 0 });
    expect(folders()).toEqual(foldersBefore);
    expect(bankRows()).toEqual(banksBefore);
    expect(db.all<PracticeLinkRow>('SELECT * FROM practice_links ORDER BY id')).toEqual(linksBefore);
  });

  it('同一 book 被不同年级共用时各建一份，题库不串年级', () => {
    copyMigrations(dir, 23);
    runMigrations(db, dir);
    db.run('INSERT INTO courses (id, name) VALUES (1, ?)', ['初中数学·七年级上册']);
    db.run('INSERT INTO courses (id, name) VALUES (2, ?)', ['初中数学·八年级上册']);
    copyMigrations(dir, 24);
    runMigrations(db, dir);
    db.run(`INSERT INTO banks (id, name, book, section, course_id) VALUES (1, ?, ?, ?, 1)`, [
      '七上期末',
      '期末测评',
      '第一章',
    ]);
    db.run(`INSERT INTO banks (id, name, book, section, course_id) VALUES (2, ?, ?, ?, 2)`, [
      '八上期末',
      '期末测评',
      '第一章',
    ]);
    copyMigrations(dir, 25);
    runMigrations(db, dir);

    expect(foldersNamed('期末测评')).toHaveLength(2);
    expect(bankRows().map((bank) => pathOf(bank.folder_id))).toEqual([
      '七年级 / 期末测评 / 第一章',
      '八年级 / 期末测评 / 第一章',
    ]);
    expect(bankRows()[0]?.folder_id).not.toBe(bankRows()[1]?.folder_id);
  });
});
