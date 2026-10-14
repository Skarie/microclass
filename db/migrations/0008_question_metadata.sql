-- 0008：题库标准化元数据（题目 + 题库）
--
-- 背景：老师要求「题库标准化和多样化建设」。要把本地教辅题库（33.98 万题）整体纳入平台，
-- 必须先统一题目元数据，才能做后续的筛选、组卷、查重与多来源聚合：
--   questions：学科 / 学段 / 书册 / 章节 / 知识点 / 来源目录 / 原题号 / 内容指纹
--   banks    ：类型（课时配套 lesson / 章节题库 chapter / 整卷试卷 paper）+ 学科 + 书册
--
-- content_hash：题干（去空白与标点、小写）的 sha1，用于跨题库查重与去重。
-- 历史数据一律留空串（未标注），由导入/回填脚本补齐，不阻塞既有功能。

ALTER TABLE questions ADD COLUMN subject TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN stage TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN book TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN chapter TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN point TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN source_path TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN source_no TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN content_hash TEXT DEFAULT '';

ALTER TABLE banks ADD COLUMN kind TEXT DEFAULT 'lesson';
ALTER TABLE banks ADD COLUMN subject TEXT DEFAULT '';
ALTER TABLE banks ADD COLUMN book TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_questions_point ON questions (subject, book, point);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions (subject, book, chapter);
CREATE INDEX IF NOT EXISTS idx_questions_content_hash ON questions (content_hash);
CREATE INDEX IF NOT EXISTS idx_banks_kind ON banks (kind);
