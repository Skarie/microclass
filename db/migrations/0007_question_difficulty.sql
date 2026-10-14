-- 0007：题目难度字段
--
-- 背景：从「思酷睿」题库导入的题目自带难度值（平台 difficult，越高越基础），
-- 老师也需要按「容易 → 中等 → 困难」筛题和组卷，因此给 questions 增加难度列。
--
-- 取值：easy / medium / hard（历史数据为空串，表示未标注）。
ALTER TABLE questions ADD COLUMN difficulty TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions (difficulty);
