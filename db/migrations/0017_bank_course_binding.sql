-- 0017：题库 → 课程 的归属字段
--
-- 背景：题库现在只有两种归属线索 ——
--   - 课时配套题库（kind=lesson）：lesson_id → lessons.course_id，天然能定位到课程；
--   - 章节题库 / 整卷试卷（kind=chapter/paper）：**没有 lesson_id**（真机 7,089 + 1,514 个），
--     只有 subject / book / point 元数据，所以在「按课程 → 章节 → 小节筛选」时根本出不来。
--
-- 本迁移加一个显式的 course_id：
--   1) 课时配套题库由 lesson 推导（脚本/接口一键回填）；
--   2) 章节题库 / 整卷试卷按 `book` 与课程名里的册次（「小学数学·二年级上册（新）」→「二年级上册（新）」）
--      匹配后回填，匹配不上的留在「未归属课程」，由老师在界面上手工挂；
--   3) 之后筛选、目录树、组卷题池都用这一列，避免每次跑模糊匹配。

ALTER TABLE banks ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_banks_course ON banks (course_id, kind);
