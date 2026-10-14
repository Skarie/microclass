-- 0010：同题不同答案（冲突题）的核对台账
--
-- 背景：全量导入后发现 771 组「题干+选项完全相同、但答案不一致」的题。
-- 这类不能像重复题那样自动删（不知道该信哪个答案），需要人工核对。
-- 把核对结果落库，体检里的「同题不同答案」就能从「待处理 N 组」变成「已核对」。
--
-- 结构说明：
--   content_hash  题目指纹（题干 + 选项归一化后的 sha1），与 questions.content_hash 对应
--   status        pending 待核对 / resolved 已选定答案 / ignored 已确认无需处理
--   chosen_answer 选定后的答案（resolved 时有值）
--   sample_stem   题干样例（列表展示用，避免每次回表）
--   group_size    组内题目数、answer_count 不同答案的个数（列表展示用）

CREATE TABLE IF NOT EXISTS question_conflicts (
  content_hash   TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'pending',
  chosen_answer  TEXT DEFAULT '',
  sample_stem    TEXT DEFAULT '',
  group_size     INTEGER DEFAULT 0,
  answer_count   INTEGER DEFAULT 0,
  reviewer_id    INTEGER,
  reviewer_name  TEXT DEFAULT '',
  updated_at     INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_question_conflicts_status ON question_conflicts (status, updated_at);
