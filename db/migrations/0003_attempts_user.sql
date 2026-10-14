-- 0003：刷题记录归属到登录用户。
-- V1 的 attempts 只有客户端标识 client_id（匿名刷题），V2 引入账号体系后
-- 需要把成绩挂到用户上；client_id 保留以兼容 V1 行与前端设备标识。
ALTER TABLE attempts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attempts_user_lesson ON attempts (user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_bank_sort ON questions (bank_id, sort, id);
CREATE INDEX IF NOT EXISTS idx_questions_lesson ON questions (lesson_id);
CREATE INDEX IF NOT EXISTS idx_banks_lesson ON banks (lesson_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_lesson ON knowledge (lesson_id, sort, id);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_user ON wrong_questions (user_id, last_at DESC);
