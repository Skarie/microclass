-- PG 侧补充：SQLite 特性对齐 + 触发器移植（在 gen-schema 生成的 DDL 之后执行）
--
-- 1) tags.name 在 SQLite 里是 `COLLATE NOCASE` 的唯一索引（大小写不敏感等值比较）；
--    PG 用 citext 保持同样语义，否则 `标签 = 'Java' / 'java'` 会变成两条。
-- 2) 三个触发器是「题库/题目冗余列」的维护逻辑，移植为 PL/pgSQL。

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE tags ALTER COLUMN name TYPE citext;

-- banks.course_id 变更 → 同步该题库下题目的 course_id
CREATE OR REPLACE FUNCTION mc_banks_course_au() RETURNS trigger AS $$
BEGIN
  UPDATE questions SET course_id = NEW.course_id WHERE bank_id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_banks_course_au ON banks;
CREATE TRIGGER trg_banks_course_au
AFTER UPDATE OF course_id ON banks
FOR EACH ROW EXECUTE FUNCTION mc_banks_course_au();

-- banks.lesson_id 变更 → 用新课时所属课程刷新题目的 bank_lesson_course_id
CREATE OR REPLACE FUNCTION mc_banks_lesson_au() RETURNS trigger AS $$
BEGIN
  UPDATE questions
     SET bank_lesson_course_id = (SELECT l.course_id FROM lessons l WHERE l.id = NEW.lesson_id)
   WHERE bank_id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_banks_lesson_au ON banks;
CREATE TRIGGER trg_banks_lesson_au
AFTER UPDATE OF lesson_id ON banks
FOR EACH ROW EXECUTE FUNCTION mc_banks_lesson_au();

-- 新增题目 → 按所属题库回填 course_id 与 bank_lesson_course_id
CREATE OR REPLACE FUNCTION mc_questions_course_ai() RETURNS trigger AS $$
BEGIN
  UPDATE questions
     SET course_id = (SELECT b.course_id FROM banks b WHERE b.id = NEW.bank_id),
         bank_lesson_course_id = (
           SELECT l.course_id FROM banks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = NEW.bank_id
         )
   WHERE id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_questions_course_ai ON questions;
CREATE TRIGGER trg_questions_course_ai
AFTER INSERT ON questions
FOR EACH ROW EXECUTE FUNCTION mc_questions_course_ai();
