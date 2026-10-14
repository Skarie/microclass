-- 0011：冲突题台账的扫描状态
--
-- 为什么需要：台账是「扫描结果物化表」，只在两种情况下可信：
--   1. 刚扫过（题目没变）；
--   2. 台账里的组仍然成立。
-- 全库扫描（36.6 万题按 content_hash 分组）在 NAS 机械盘上要几秒，
-- 不能每次打开页面都扫，但也不能只扫一次——导入新题库后会冒出新的冲突组。
-- 因此记下「上次扫描的题目最大 id + 时间」：题量增长过或超过 TTL 就自动重扫。
--
-- 单行表：id 恒为 1。

CREATE TABLE IF NOT EXISTS question_conflict_meta (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_at      INTEGER NOT NULL DEFAULT 0,
  questions_max_id  INTEGER NOT NULL DEFAULT 0,
  conflict_total    INTEGER NOT NULL DEFAULT 0,
  pending_total     INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO question_conflict_meta (id, last_sync_at, questions_max_id)
VALUES (1, 0, 0);
