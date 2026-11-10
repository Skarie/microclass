-- 0029：题组 / 变式关联（母题 + 若干变式）
--
-- 背景：题库里的题是**平铺**的，同一考点的「母题 + 变式」只能靠章节/知识点间接相邻，
-- 组卷时也没法「整组抽一题、或者整组一起练」。这里只加两张关联表，**不动 questions**：
--   - question_groups       一个题组（名字 + 备注），创建人记录 created_by；
--   - question_group_items  组内成员，role = stem（母题）/ variant（变式），sort 决定组内顺序。
--
-- 为什么 role 不在库里做 CHECK：SQLite 改 CHECK 要重建表；role 目前只有两个值，
-- 由服务层（questionGroupService.normalizeRole）统一校验，非法值返回 400 而不是 500。
-- 为什么不建在 questions 上：一道题可以同时属于多个题组（跨册复习、专题卷都会这么用），
-- 主键 (group_id, question_id) 保证同一组内不重复。
--
-- 外键 ON DELETE CASCADE：Db 构造时已开 `PRAGMA foreign_keys = ON`（见 db/client.ts），
-- 删组会连带删 items；删题时 items 也跟着走，不会留下指向不存在题目的脏行。

CREATE TABLE IF NOT EXISTS question_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

-- 列表按标题搜（LIKE 前缀之外还能走索引做等值/排序）
CREATE INDEX IF NOT EXISTS idx_question_groups_title ON question_groups (title);

CREATE TABLE IF NOT EXISTS question_group_items (
  group_id    INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  role        TEXT NOT NULL DEFAULT 'variant',   -- stem | variant（服务层校验）
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, question_id),
  FOREIGN KEY (group_id) REFERENCES question_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 反查「这道题属于哪些题组」（题目详情弹窗用）
CREATE INDEX IF NOT EXISTS idx_question_group_items_question ON question_group_items (question_id);
