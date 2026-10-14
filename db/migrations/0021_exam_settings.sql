-- 考试设置（对标超星学习通等平台的"考试设置"）：
--   start_at / end_at     考试时间窗口（学习通：立即发放 / 定时发放）
--   attempt_limit         允许作答次数（0 = 不限）
--   shuffle_questions     题目顺序随机
--   show_answers          交卷后是否向学员公布答案解析
--
-- 为什么单独一列存而不是塞进 structure：这些是**作答行为**的开关，
-- 作答端与成绩端都要读，放 JSON 里会到处解析、也容易漏判。
ALTER TABLE exams ADD COLUMN start_at INTEGER DEFAULT 0;
ALTER TABLE exams ADD COLUMN end_at INTEGER DEFAULT 0;
ALTER TABLE exams ADD COLUMN attempt_limit INTEGER DEFAULT 0;
ALTER TABLE exams ADD COLUMN shuffle_questions INTEGER DEFAULT 0;
ALTER TABLE exams ADD COLUMN show_answers INTEGER DEFAULT 1;
