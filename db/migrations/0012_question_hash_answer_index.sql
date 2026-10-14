-- 0012：冲突题扫描用的覆盖索引
--
-- 背景：「同题不同答案」的扫描要按 content_hash 分组，并对每组的 answer 做
-- MIN/MAX/COUNT(DISTINCT)。原来只有 `idx_questions_content_hash (content_hash)`，
-- SQLite 分组后为拿到 answer 得一题一题回表 —— 36.6 万题 / 600MB 的库在 NAS 机械盘上
-- **冷缓存实测要 50 秒到 10 分钟**（真机数据），把整个事件循环都占住了。
--
-- 加上 (content_hash, answer) 后这条查询变成**纯索引扫描**（覆盖索引，不回表），
-- 题干样例改为只对冲突组（几百组）单独取。索引本身约十几 MB。

CREATE INDEX IF NOT EXISTS idx_questions_hash_answer ON questions (content_hash, answer);
