-- 0006：课程绑定媒体文件夹（参考飞牛「轻课堂」的 courses.folder_path / scan_status 思路）
--
-- 用户诉求：「先创建课程，再在课程里直接读取目录导入课时；以后加了新课，扫描一下就好」。
-- 为此课程要记住自己对应的磁盘文件夹，课时要能区分「扫出来的」和「手工建的」。
--
-- 1) courses 记录绑定的媒体根与相对路径：
--    - folder_root_id  媒体根 id（对应 settings.media_roots 里的一项）
--    - folder_path     该媒体根下的相对路径（空串 = 根目录本身）
--    - last_scan_at    上次扫描导入时间（Unix 秒），界面上用于提示「有新视频未导入」
ALTER TABLE courses ADD COLUMN folder_root_id TEXT;
ALTER TABLE courses ADD COLUMN folder_path TEXT;
ALTER TABLE courses ADD COLUMN last_scan_at INTEGER;

-- 2) lessons.source 区分来源：
--    - manual  手工创建 / 网页上传（重新扫描时绝不自动删除）
--    - folder  课程文件夹扫描导入（重新扫描时章节名跟随文件夹，文件消失可被清理）
ALTER TABLE lessons ADD COLUMN source TEXT DEFAULT 'manual';

-- 3) 新课时的排序与「按路径找已导入课时」都会走索引
CREATE INDEX IF NOT EXISTS idx_lessons_course_sort ON lessons (course_id, sort);
CREATE INDEX IF NOT EXISTS idx_lessons_media_path ON lessons (media_root, video_path);
