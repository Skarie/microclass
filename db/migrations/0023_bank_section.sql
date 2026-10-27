-- 0023：题库的「章节」字段
--
-- 背景：题库原来只能按「课程 → 册次 → 题库」归类，一批没有绑定课程、
-- 只有册次（甚至册次为空）的题库在左侧分类里装不下。现在让题库自己也能按
-- 「册次 → 章节」归类，同时保持按课程视图：
--   - section 由老师手填，或新建/编辑时从绑定的课时 group_name 自动继承；
--   - 历史数据由 POST /banks/backfill-sections 批量回填（课时优先，其次解析题库名）；
--   - GET /banks/catalog-sections 按 book → section 分组（view=book）；
--   - 索引覆盖「按课程 → 册次 → 章节」的目录聚合与筛选。
ALTER TABLE banks ADD COLUMN section TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_banks_course_book_section ON banks (course_id, book, section);
