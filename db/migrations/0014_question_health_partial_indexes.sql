-- 0014：题库体检用的「空值列」部分索引
--
-- 背景：体检的五个计数原来写成一条
--   SELECT COUNT(*), SUM(CASE WHEN difficulty='' …), SUM(CASE WHEN answer='' …),
--          SUM(CASE WHEN has_image=1 …), SUM(CASE WHEN content_hash='' …) FROM questions
-- 其中 difficulty / answer / content_hash 都不在任何索引里 → 全表扫描。
-- 真机上冷缓存实测 **505 秒**（顺序读只有 ~1.9MB/s，库 620MB），体检页看起来就像卡死。
--
-- 修法：给「空答案 / 空难度 / 空指纹」建**部分索引**（WHERE 条件写在索引里）。
-- 这三类行在正常运行中几乎不存在（真机实测：空难度 21 行、空答案 0 行、空指纹 0 行），
-- 所以索引本身只有几十字节，SQLite 又能把 `WHERE answer = ''` 这类查询直接落到这个索引上 ——
-- 计数从「读整库」变成「读几十行」。带图统计走既有的 idx_questions_has_image。
--
-- 注意：部分索引只在查询条件与索引条件一致时才会被使用（这里刻意保持写法一致）。

CREATE INDEX IF NOT EXISTS idx_questions_empty_answer ON questions (answer) WHERE answer = '';
CREATE INDEX IF NOT EXISTS idx_questions_no_difficulty ON questions (difficulty) WHERE difficulty = '';
CREATE INDEX IF NOT EXISTS idx_questions_no_hash ON questions (content_hash) WHERE content_hash = '';
