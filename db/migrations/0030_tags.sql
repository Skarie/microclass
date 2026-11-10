-- 0030：自由标签 + 高级检索（顺带补上 P0 题组的 updated_at）
--
-- 背景：知识点（questions.point）是**教学归属**，只能表达「这题考什么」；
-- 教研标记（易错 / 高考真题 / 自编 / 需重录）没有地方放，只能塞进备注里靠关键词搜。
-- 这里加两张关联表：
--   - tags              标签本身（名字 + 备注），全局唯一（同名只允许一个）；
--   - question_tags     题目 ↔ 标签多对多，主键 (question_id, tag_id) 保证不重复。
--
-- name 唯一按**大小写不敏感**（COLLATE NOCASE）：老师输入「易错」和「易错」没问题，
-- 但「易错」/「易錯」/「易 错」这类手误不该产生三个标签 —— 应用层再 trim 一次。
-- 外键 ON DELETE CASCADE：删标签自动清关联；删题目也自动清关联（Db 已开 PRAGMA foreign_keys）。
--
-- 同时补 P0 的遗留：question_groups 只有 created_at，改标题/加题后列表排序没有依据。
-- 加 updated_at 后由服务层在「改组信息 / 加题 / 移题」时刷新，列表与接口 updatedAt 都用它。
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN **不允许非常量默认值**（DEFAULT (datetime('now')) 会报错），
-- 所以先加 DEFAULT ''，再用 created_at 回填历史行；新行由服务层显式写 datetime('now')。

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

-- 唯一索引（大小写不敏感）+ 前缀搜索都用它
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id INTEGER NOT NULL,
  tag_id      INTEGER NOT NULL,
  PRIMARY KEY (question_id, tag_id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 反查「这个标签下有哪些题」（筛选 / 计数走这里）
CREATE INDEX IF NOT EXISTS idx_question_tags_tag ON question_tags (tag_id);

ALTER TABLE question_groups ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE question_groups SET updated_at = created_at;
