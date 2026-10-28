-- 0025：题目章节/小节 + 实践关联（一个目标关联多个课时）
--
-- 背景：题库页改成文件夹树后，产品又提了三件事：
--   1) 目录顶层按「年级（关联课程）/ 系列（未关联课程）」重组；
--   2) 题库内的题目要能按章节 / 小节分组与筛选；
--   3) 一个课时练习可以同时关联多个课时，目标支持 题库 / 章节 / 小节 / 单题。
--
-- 说明：`questions.chapter` 已在迁移 0008 建过（TEXT DEFAULT ''），
-- 这里**复用**它作为「章节」，不重复 ADD COLUMN（否则 SQLite 直接报 duplicate column）；
-- 0025 只补 `section`（小节），并把两者纳入同一索引。
--
-- `practice_links` 是关联目标；`practice_link_lessons` 是目标 ↔ 课时的多对多。
-- 旧 `banks.lesson_id` 不删除：迁移执行器的 0025 数据钩子会把它转成
-- target_type='bank' 的 practice_links，旧接口与旧数据继续兼容。
ALTER TABLE questions ADD COLUMN section TEXT NOT NULL DEFAULT '';

-- 0008 的 chapter 允许 NULL（只给了 DEFAULT ''）；统一成空串，避免 `chapter = ''`
-- 的「未分章」筛选漏掉历史 NULL 行。
UPDATE questions SET chapter = '' WHERE chapter IS NULL;

CREATE INDEX IF NOT EXISTS idx_questions_chapter_section ON questions (bank_id, chapter, section);

CREATE TABLE IF NOT EXISTS practice_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,          -- 'bank' | 'chapter' | 'section' | 'question'
  bank_id INTEGER NOT NULL,           -- 目标题库（question 目标也必有 bank）
  question_id INTEGER,                -- target_type='question' 时必填
  chapter TEXT NOT NULL DEFAULT '',   -- target_type='chapter'/'section' 时用
  section TEXT NOT NULL DEFAULT '',   -- target_type='section' 时用
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_practice_links_bank ON practice_links (bank_id);

CREATE TABLE IF NOT EXISTS practice_link_lessons (
  link_id INTEGER NOT NULL,
  lesson_id INTEGER NOT NULL,
  PRIMARY KEY (link_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_practice_link_lessons_lesson ON practice_link_lessons (lesson_id);
