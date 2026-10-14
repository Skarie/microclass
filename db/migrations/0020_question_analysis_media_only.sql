-- 解析「只有图片、没有文字」预计算列。
--
-- 背景：教辅原始数据里有相当一部分题的解析本身就是一张文字截图（真机全库 366,867 题中
-- 有 167,137 题的解析含图，其中 19,507 题的解析**除了图片没剩下一个字**）。
-- 这类题在界面上只剩一张图：按关键字搜解析搜不到、文字复制不出来、老师想改也无处下手。
--
-- 判定规则在写库时用 `hasMediaOnlyAnalysis()`（apps/api/src/domain/question.ts）算好；
-- 历史数据用 `ops/scripts/backfill-question-meta.mjs --only analysis-media` 一次性回填。
--
-- 部分索引只覆盖 = 1 的行（真机约 1.95 万行），因此体检里的计数与题库内筛选都很便宜，
-- 不需要在请求路径上对 36.7 万行做 LIKE + 字符串剥离。
ALTER TABLE questions ADD COLUMN analysis_media_only INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_questions_analysis_media_only
  ON questions(bank_id)
  WHERE analysis_media_only = 1;
