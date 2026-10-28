-- 0024：题库改为「文件夹树」归类
--
-- 背景：题库原来靠 book / section 两个字段归类，只能表达「册次 → 章节」两级，
-- 而且册次不是真正的分类（必刷题、复习卷、无册次的资料都塞不进去）。现在把题库
-- 归属改成可多层的文件夹树：
--   - bank_folders 自引用（parent_id NULL = 顶层），题库通过 banks.folder_id 挂到叶子；
--   - folder_id IS NULL = 未分类；
--   - 不删除 book / section，旧接口与历史数据保持兼容；
--   - 历史 book / section 由紧随 DDL 的 node 回填脚本（db/migrations 执行器里的
--     0024 数据钩子）转成两级文件夹，只跑一次。
CREATE TABLE IF NOT EXISTS bank_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER,                 -- NULL = 顶层
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_id) REFERENCES bank_folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bank_folders_parent ON bank_folders (parent_id, sort, id);

ALTER TABLE banks ADD COLUMN folder_id INTEGER;   -- NULL = 未分类

CREATE INDEX IF NOT EXISTS idx_banks_folder ON banks (folder_id);
