-- 0018：试卷结构（大题分组 / 每题分值 / 目标难度配比）
--
-- 现状：exam_questions 只有 (exam_id, question_id, sort)，**没有分值**，
-- 判分只能按「对几题 / 共几题 × 100」折算；也没有大题分组（一、选择题 二、填空题…），
-- 组卷时看不到「这卷子够不够 100 分、题型配比对不对」。
--
-- 参考主流组卷系统（智学网一类）的做法，补三块：
--   1) 每题分值：`exam_questions.score`（0 = 跟随试卷总分自动均分，保持旧卷子行为不变）
--   2) 大题分组：`exam_questions.section`（如「一、选择题」），同一大题共用一个分值更好出卷
--   3) 试卷级配置：`exams.structure`（大题列表：名称/题型/每题分值/说明）
--      `exams.difficulty_target`（目标难度配比 {"easy":0.3,"medium":0.5,"hard":0.2}）
--      `exams.total_score`（试卷总分，默认 100）

ALTER TABLE exam_questions ADD COLUMN score REAL DEFAULT 0;
ALTER TABLE exam_questions ADD COLUMN section TEXT DEFAULT '';

ALTER TABLE exams ADD COLUMN structure TEXT DEFAULT '[]';
ALTER TABLE exams ADD COLUMN difficulty_target TEXT DEFAULT '';
ALTER TABLE exams ADD COLUMN total_score INTEGER DEFAULT 100;

-- 组卷时按「课程 + 题型 + 难度」快速找题
CREATE INDEX IF NOT EXISTS idx_questions_type_difficulty ON questions (type, difficulty);
