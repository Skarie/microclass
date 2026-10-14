-- 0022_questions_course_denormalize.sql
--
-- 背景：课程范围选题池的过滤条件是
--   (b.course_id = ? OR b.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
--    OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?))
-- 查询以 questions（37 万行）为驱动表，逐行回查 banks 求值这个 OR —— banks 上的索引用不上，
-- 实测「本课程池」205ms（全库池仅 30ms），随机组卷 / 平行组卷 / 取卷子都继承这份成本。
--
-- 做法：**只把归属冗余到题目行**（不改 banks，避免动到「按课时推导归属」等既有行为），
-- 过滤条件改为三个可用索引的分支：
--   q.course_id               ← banks.course_id（题库归属课程）
--   q.bank_lesson_course_id   ← banks.lesson_id 对应课时的课程（题库只挂课时、未挂课程的情况）
--   q.lesson_id IN (...)      ← 题目本身挂在课程课时下（idx_questions_lesson）

ALTER TABLE questions ADD COLUMN course_id INTEGER;
ALTER TABLE questions ADD COLUMN bank_lesson_course_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_questions_course ON questions (course_id);
CREATE INDEX IF NOT EXISTS idx_questions_bank_lesson_course ON questions (bank_lesson_course_id);

-- 回填（37 万行一次；后续变更由触发器兜住）
UPDATE questions
   SET course_id = (SELECT b.course_id FROM banks b WHERE b.id = questions.bank_id),
       bank_lesson_course_id = (
         SELECT l.course_id FROM banks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = questions.bank_id
       );

-- 触发器 1：新增题目 → 从所属题库取两个归属
CREATE TRIGGER IF NOT EXISTS trg_questions_course_ai
AFTER INSERT ON questions
BEGIN
  UPDATE questions
     SET course_id = (SELECT b.course_id FROM banks b WHERE b.id = NEW.bank_id),
         bank_lesson_course_id = (
           SELECT l.course_id FROM banks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = NEW.bank_id
         )
   WHERE id = NEW.id;
END;

-- 触发器 2：题库换课程（含按册次批量挂课程）
CREATE TRIGGER IF NOT EXISTS trg_banks_course_au
AFTER UPDATE OF course_id ON banks
BEGIN
  UPDATE questions SET course_id = NEW.course_id WHERE bank_id = NEW.id;
END;

-- 触发器 3：题库换课时 → 刷新"题库课时所属课程"
CREATE TRIGGER IF NOT EXISTS trg_banks_lesson_au
AFTER UPDATE OF lesson_id ON banks
BEGIN
  UPDATE questions
     SET bank_lesson_course_id = (
           SELECT l.course_id FROM lessons l WHERE l.id = NEW.lesson_id
         )
   WHERE bank_id = NEW.id;
END;
