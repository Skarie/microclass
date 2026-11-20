-- 0031：题库体检结果的**持久缓存**（配合后台 worker 计算）
--
-- 背景：`GET /api/v1/banks/health` 是同步驱动的 SQLite 全表聚合（生产 39.6 万题 / 库 1.2GB），
-- 冷缓存时会把 Node 事件循环占住约 6.5 分钟 —— 期间所有接口超时、健康检查变 unhealthy，
-- 而管理端「总览」首页恰好会请求它。修法：把聚合搬进 worker 线程（主线程不阻塞），
-- 并把结果落库，进程重启后仍能秒回。
--
-- 单行表：`id INTEGER PRIMARY KEY CHECK (id = 1)` 保证只有一条当前快照；
-- `payload` 是体检结果 JSON（与接口返回的 scope/stats/metadata/duplicates/kinds/difficulty 同构），
-- `computed_at` 是 ISO 时间字符串（服务层按 TTL 24h 判断是否过期）。
CREATE TABLE IF NOT EXISTS bank_health_cache (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  computed_at TEXT NOT NULL,
  payload     TEXT NOT NULL
);

-- 按时间判断新鲜度 / 运维排查「上次体检是什么时候」走这个索引
CREATE INDEX IF NOT EXISTS idx_bank_health_cache_computed_at ON bank_health_cache (computed_at);
