-- 0019：题库题量的预计算列
--
-- 背景（真机实测）：题库管理页首屏要显示「每个题库多少题」，
-- 原来用 `(SELECT COUNT(*) FROM questions WHERE bank_id = b.id)`（相关子查询）或
-- `GROUP BY bank_id` 现算 —— 两者都要扫 36.6 万题 / 620MB 的表：
--   · 相关子查询：1.2 万个题库 → 1.2 万次随机索引查找；
--   · 分组统计：一次全表扫描。
-- 在这台 NAS 上冷缓存实测 **100 秒**（期间 node:sqlite 同步执行，整个站点都被卡住，
-- 用户侧表现为浏览器请求挂 100 秒）。
--
-- 修法：把题量做成 `banks.question_count` 预计算列，由题目增删改的写路径维护，
-- 页面查询只读 banks 这张小表（1.2 万行）。另提供 `POST /banks/fix-question-counts`
-- 兜底重算一次（万一有脚本绕过写路径改了题目）。

ALTER TABLE banks ADD COLUMN question_count INTEGER NOT NULL DEFAULT 0;

-- 一次性回填（跑一次全表分组，之后不再需要）
UPDATE banks
SET question_count = (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id);
