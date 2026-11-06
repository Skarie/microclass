-- 0028：站内公告
--
-- 背景：首页/工作台需要一个「运营公告」入口（停服维护、新课上线、考试提醒）。
-- 公告只有管理员能写，学生登录即可读；`published` 让管理员先存草稿再发布，
-- `pinned` 置顶几条重要公告。`created_at` 沿用项目里 TEXT 时间（datetime('now')，UTC），
-- 与 practice_links 等表保持一致。
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  level      TEXT NOT NULL DEFAULT 'info',      -- info | warning | danger
  pinned     INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

-- 公开列表的固定排序：已发布 → 置顶优先 → 时间倒序
CREATE INDEX IF NOT EXISTS idx_announcements_feed ON announcements (published, pinned DESC, created_at DESC);
