-- 0015：元数据覆盖率统计用的「空值列」部分索引（subject / book / point）
--
-- 背景：迁移 0014 解决了体检里 difficulty / answer / content_hash 的空值统计，
-- 但体检还要报「学科 / 书册 / 知识点覆盖率」，原来是
--   SELECT COUNT(*) FROM questions WHERE subject <> ''
-- 这类 **`<> ''` 没有任何索引可用**的查询 —— 真机冷缓存实测一次要读完整库，
-- 四个覆盖率加起来把体检拖到 11 分钟（实测）。
--
-- 修法：给「空值」那一侧建部分索引（这三列在正常运行中几乎不空：真机实测各 75 行），
-- 仓储层把覆盖率算成 `总数 − 空值数`，两边都走索引，冷缓存也就几毫秒。
--
-- 注意：部分索引只在查询条件与索引条件一致时才会被使用（这里刻意保持 `col = ''` 的写法）。

CREATE INDEX IF NOT EXISTS idx_questions_no_subject ON questions (subject) WHERE subject = '';
CREATE INDEX IF NOT EXISTS idx_questions_no_book ON questions (book) WHERE book = '';
CREATE INDEX IF NOT EXISTS idx_questions_no_point ON questions (point) WHERE point = '';
