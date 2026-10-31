-- 0027：题目的「题源标识」（source_id）
--
-- 背景：教师版题库（`题库_教师版/.../题目.md`）里每道题都带一个稳定的
-- `**题目标识：** 511916`。整册覆盖导入时，它是**唯一能稳定定位同一道题**的键
-- （题干会改、题号会变），后续「按源更新 / 统计哪些题来自哪份资料 / 增量补题」
-- 都要靠它，所以单独存一列，而不是混在 source_no（原题号，随卷面顺序变化）里。
--
-- 历史数据留空串（未标注）。旧接口与旧导入（CSV / manifest）不写这一列，行为不变。
ALTER TABLE questions ADD COLUMN source_id TEXT DEFAULT '';

-- 同一来源标识去重 / 定位：按来源查题、查「这个标识是否已导入过」
CREATE INDEX IF NOT EXISTS idx_questions_source_id ON questions (source_id);
