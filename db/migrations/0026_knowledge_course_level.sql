-- 0026: 知识点支持「课程级」（不挂课时，整门课共享）。
--
-- SQLite 不能直接去掉列上的 NOT NULL，只能重建表：
--   建新表 → 复制全部数据 → 校验行数一致 → 删旧表 → 改名 → 重建索引。
-- 行数校验用「只允许 1 的守卫表 + CHECK 约束」实现：复制前后数量不一致时
-- CHECK 失败，迁移所在事务整体回滚，不会静默丢数据。
--
-- 两种归属互斥：课时级 lesson_id 非空 / 课程级 course_id 非空。
-- 保留原有的 lessons 外键级联删除，并为课程级补上 courses 外键。
DROP TABLE IF EXISTS _knowledge_migration_guard;

CREATE TABLE knowledge_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  course_id  INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','file','link')),
  file_name  TEXT DEFAULT '',
  file_path  TEXT DEFAULT '',
  content    TEXT DEFAULT '',
  url        TEXT DEFAULT '',
  sort       INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  CHECK ((lesson_id IS NOT NULL) <> (course_id IS NOT NULL))
);

INSERT INTO knowledge_new (id, lesson_id, course_id, title, kind, file_name, file_path, content, url, sort, created_at)
SELECT id, lesson_id, NULL, title, kind, file_name, file_path, content, url, sort, created_at
FROM knowledge;

CREATE TEMP TABLE _knowledge_migration_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _knowledge_migration_guard (ok)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM knowledge) = (SELECT COUNT(*) FROM knowledge_new) THEN 1
  ELSE 0
END;

DROP TABLE _knowledge_migration_guard;

DROP TABLE knowledge;

ALTER TABLE knowledge_new RENAME TO knowledge;

CREATE INDEX IF NOT EXISTS idx_knowledge_lesson ON knowledge (lesson_id, sort, id);
CREATE INDEX IF NOT EXISTS idx_knowledge_course ON knowledge (course_id, sort, id);
