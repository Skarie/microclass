/**
 * 0026 迁移：knowledge 重建为「课时级 / 课程级」两用表。
 * 重点是重建过程不丢数据、lesson_id 可空、course_id 与索引存在。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrations.js';

const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');

describe('0026 knowledge 课程级迁移', () => {
  let db: Db;
  let dir: string;
  let legacyDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kn-mig-'));
    legacyDir = path.join(dir, 'legacy');
    fs.mkdirSync(legacyDir);
    // 只放 0026 之前的迁移，模拟旧库
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f < '0026')) {
      fs.copyFileSync(path.join(migrationsDir, file), path.join(legacyDir, file));
    }
    db = openDb(dir, 'test.db');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function upgrade(): void {
    const before = runMigrations(db, legacyDir);
    expect(before.applied.some((m) => m.version === '0025')).toBe(true);
    // 造旧数据：课程 + 课时 + 两种知识点
    db.run("INSERT INTO courses (name) VALUES ('旧课程')");
    db.run(
      "INSERT INTO lessons (title, video_kind, video_path, course_id) VALUES ('旧课时', 'url', 'https://x/1.mp4', 1)",
    );
    db.run("INSERT INTO knowledge (lesson_id, title, kind, content, sort) VALUES (1, '旧文本', 'text', '正文', 1)");
    db.run(
      "INSERT INTO knowledge (lesson_id, title, kind, file_name, file_path, sort) VALUES (1, '旧附件', 'file', 'a.pdf', 'knowledge/a.pdf', 2)",
    );
    // 把 0026 放进来，执行剩余迁移
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f >= '0026')) {
      fs.copyFileSync(path.join(migrationsDir, file), path.join(legacyDir, file));
    }
    const after = runMigrations(db, legacyDir);
    expect(after.applied.map((m) => m.version)).toContain('0026');
  }

  it('重建表后旧数据行数一致、内容不变', () => {
    upgrade();
    const rows = db.all<{ id: number; title: string; kind: string; content: string; lesson_id: number | null }>(
      'SELECT * FROM knowledge ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 1, title: '旧文本', kind: 'text', content: '正文', lesson_id: 1 });
    expect(rows[1]).toMatchObject({ id: 2, title: '旧附件', kind: 'file', lesson_id: 1 });
  });

  it('lesson_id 可空、course_id 存在，且默认旧数据 course_id 为 NULL', () => {
    upgrade();
    const columns = db.all<{ name: string; notnull: number }>('PRAGMA table_info(knowledge)');
    expect(columns.find((c) => c.name === 'lesson_id')?.notnull).toBe(0);
    expect(columns.map((c) => c.name)).toContain('course_id');
    const old = db.get<{ course_id: number | null }>('SELECT course_id FROM knowledge WHERE id = 1');
    expect(old?.course_id).toBeNull();
  });

  it('课程级知识点可写入（lesson_id 为空），且两种归属互斥', () => {
    upgrade();
    db.run("INSERT INTO knowledge (course_id, title, kind, content) VALUES (1, '课程共享', 'text', '正文')");
    expect(
      db.get<{ course_id: number | null; lesson_id: number | null }>(
        "SELECT course_id, lesson_id FROM knowledge WHERE title = '课程共享'",
      ),
    ).toMatchObject({ course_id: 1, lesson_id: null });
    expect(() => db.run("INSERT INTO knowledge (title, kind) VALUES ('无归属', 'text')")).toThrow();
    expect(() =>
      db.run("INSERT INTO knowledge (lesson_id, course_id, title, kind) VALUES (1, 1, '双重归属', 'text')"),
    ).toThrow();
  });

  it('保留课时索引并新增课程索引', () => {
    upgrade();
    const indexes = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'knowledge'")
      .map((r) => r.name);
    expect(indexes).toContain('idx_knowledge_lesson');
    expect(indexes).toContain('idx_knowledge_course');
  });
});
