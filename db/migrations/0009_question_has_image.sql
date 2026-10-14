-- 0009：题目是否带图的预计算列
--
-- 背景：题库体检要统计「带图 / 不带图」，原先用
--   `stem LIKE '%question-media%' OR options LIKE '%question-media%' OR analysis LIKE '%question-media%'`
-- 在 36.6 万题（590MB 的库、NAS 机械盘）上要反复全表扫描，一次体检要几十秒。
-- 把结果预先算好存成一列，体检就只剩一次聚合并可走内存。
--
-- 导入器会对新导入的题目写入这一列；历史数据由 ops/scripts/backfill-has-image.mjs 回填。

ALTER TABLE questions ADD COLUMN has_image INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_questions_has_image ON questions (has_image);
