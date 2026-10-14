-- 0001_initial_schema.sql
-- 基线结构：与 V1（legacy/server.js）完全一致，保证既有 microclass.db 可直接接管。
-- 全部使用 IF NOT EXISTS，可在既有库上安全执行。

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT UNIQUE NOT NULL,
  pass_salt    TEXT NOT NULL,
  pass_hash    TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin','teacher','student')),
  display_name TEXT DEFAULT '',
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  sort       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort        INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch()),
  category_id INTEGER,
  cover       TEXT DEFAULT '',
  published   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lessons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  video_kind  TEXT NOT NULL DEFAULT 'local' CHECK (video_kind IN ('local','embed','url')),
  media_root  TEXT DEFAULT '',
  video_path  TEXT DEFAULT '',
  sort        INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch()),
  group_name  TEXT DEFAULT '',
  course_id   INTEGER
);

CREATE TABLE IF NOT EXISTS knowledge (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','file','link')),
  file_name  TEXT DEFAULT '',
  file_path  TEXT DEFAULT '',
  content    TEXT DEFAULT '',
  url        TEXT DEFAULT '',
  sort       INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS banks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id    INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  type       TEXT NOT NULL CHECK (type IN ('single','multiple','judge','fill','short')),
  stem       TEXT NOT NULL,
  image_path TEXT DEFAULT '',
  options    TEXT DEFAULT '[]',
  answer     TEXT DEFAULT '',
  analysis   TEXT DEFAULT '',
  sort       INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  TEXT NOT NULL,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  answers    TEXT DEFAULT '[]',
  score      INTEGER DEFAULT 0,
  total      INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id    INTEGER NOT NULL,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position   REAL DEFAULT 0,
  duration   REAL DEFAULT 0,
  finished   INTEGER DEFAULT 0,
  quiz_done  INTEGER DEFAULT 0,
  quiz_best  INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS lesson_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  pos        REAL DEFAULT 0,
  text       TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS wrong_questions (
  user_id     INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  wrong_count INTEGER DEFAULT 1,
  mastered    INTEGER DEFAULT 0,
  last_at     INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL,
  course_id  INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT DEFAULT '',
  duration_minutes INTEGER DEFAULT 60,
  pass_score       INTEGER DEFAULT 60,
  status           TEXT DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at       INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  sort        INTEGER DEFAULT 0,
  PRIMARY KEY (exam_id, question_id)
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id      INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL,
  answers      TEXT DEFAULT '[]',
  score        INTEGER DEFAULT 0,
  total        INTEGER DEFAULT 0,
  passed       INTEGER DEFAULT 0,
  used_seconds INTEGER DEFAULT 0,
  created_at   INTEGER DEFAULT (unixepoch())
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_lessons_course        ON lessons (course_id, sort);
CREATE INDEX IF NOT EXISTS idx_lessons_group         ON lessons (group_name);
CREATE INDEX IF NOT EXISTS idx_knowledge_lesson      ON knowledge (lesson_id, sort);
CREATE INDEX IF NOT EXISTS idx_questions_bank        ON questions (bank_id, sort);
CREATE INDEX IF NOT EXISTS idx_questions_lesson      ON questions (lesson_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_lesson  ON attempts (client_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_progress_user         ON lesson_progress (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_user_lesson     ON lesson_notes (user_id, lesson_id, pos);
CREATE INDEX IF NOT EXISTS idx_wrong_user            ON wrong_questions (user_id, mastered, last_at);
CREATE INDEX IF NOT EXISTS idx_exams_course          ON exams (course_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user    ON exam_attempts (exam_id, user_id);
