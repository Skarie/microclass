-- 0005：视频元数据与观看区间（参考飞牛「轻课堂」的做法）
--
-- 1) lessons 增加媒体元数据列：
--    - duration    视频总秒数（ffprobe 抽取；用于列表展示与「看完 80%」判定）
--    - cover_path  封面图相对路径（ffmpeg 抽帧，存 uploads/covers）
--    - media_type  媒体类型（video/audio/other），为后续支持音频课与文档预留
--    另加 probed_at 记录抽取时间，便于只对未抽取的课时做后台任务。
ALTER TABLE lessons ADD COLUMN duration INTEGER;
ALTER TABLE lessons ADD COLUMN cover_path TEXT DEFAULT '';
ALTER TABLE lessons ADD COLUMN media_type TEXT DEFAULT 'video';
ALTER TABLE lessons ADD COLUMN probed_at INTEGER;

-- 2) 观看区间：按「用户 + 课时 + 起止秒」记录已看片段。
--    轻课堂用同样的思路（watch_intervals）；相比单一 position，
--    它能真实反映「是否完整看过」（拖到最后不会算作看完）。
CREATE TABLE IF NOT EXISTS watch_intervals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  start_sec   INTEGER NOT NULL,
  end_sec     INTEGER NOT NULL,
  updated_at  INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_watch_intervals_user_lesson ON watch_intervals (user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_lessons_probed ON lessons (probed_at);
