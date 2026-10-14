-- 0016：题目难度模型（内容特征先验 + 作答校准 + 人工优先）
--
-- 背景：difficulty 只有 easy/medium/hard，且是从采集源「难度值」直接映射来的，
-- 真机数据里 66% 都是 medium、跨学段自相矛盾（小学 hard 16,347 道 vs 高中 95 道），
-- 老师看不出难易梯度。改成主流做法：
--
--   difficulty_score   0–100 综合分（模型算出来的中间量，保留精度便于排序/分档）
--   difficulty_source  auto 模型先验 / calibrated 含作答数据校准 / manual 老师手改（**永不被自动覆盖**）
--   difficulty_n       参与校准的作答样本数
--   difficulty_p       经验正确率（Beta 收缩后），用于审计与解释
--   difficulty_at      最近一次计算时间
--
-- difficulty（easy/medium/hard）继续保留：它由分位数阈值从 difficulty_score 派生，
-- 组卷的难度配额、按难度筛选等既有功能不受影响。

ALTER TABLE questions ADD COLUMN difficulty_score INTEGER DEFAULT -1;
ALTER TABLE questions ADD COLUMN difficulty_source TEXT DEFAULT '';
ALTER TABLE questions ADD COLUMN difficulty_n INTEGER DEFAULT 0;
ALTER TABLE questions ADD COLUMN difficulty_p REAL DEFAULT NULL;
ALTER TABLE questions ADD COLUMN difficulty_at INTEGER DEFAULT 0;

-- 按难度分排序/统计（例如「列出最难的前 100 题」）
CREATE INDEX IF NOT EXISTS idx_questions_difficulty_score ON questions (difficulty_score);
-- 按来源统计（模型/校准/人工各多少），也便于「只重算 auto」这类增量任务
CREATE INDEX IF NOT EXISTS idx_questions_difficulty_source ON questions (difficulty_source);
