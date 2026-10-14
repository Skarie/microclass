-- 0013：删掉被覆盖索引取代的旧索引
--
-- `idx_questions_hash_answer (content_hash, answer)`（迁移 0012）以 `content_hash` 为前导列，
-- 任何按 `content_hash` 过滤/分组的查询都能走它（前缀可用），
-- 所以 `idx_questions_content_hash (content_hash)` 变成纯冗余：
-- 只会让每次写题目多维护一棵索引树、多占十几 MB，不带来任何查询能力。
--
-- 背景：真机上这台 NAS 的顺序写只有 ~1.6MB/s（VACUUM 600MB 要 386 秒），
-- 索引写放大是实打实的成本 —— 全量重算 36.6 万条指纹时尤其明显。

DROP INDEX IF EXISTS idx_questions_content_hash;
