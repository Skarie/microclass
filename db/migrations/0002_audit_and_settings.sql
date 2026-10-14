-- 0002_audit_and_settings.sql
-- 企业级补充：操作审计日志 + 站点设置默认值（会话/注册策略可审计、可回滚）。

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  request_id  TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs (actor_id, created_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_register', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_note', 'V2 企业级重构基线');
