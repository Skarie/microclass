-- 0004：把 V1 遗留的刷题记录归属回用户。
-- V1 的 attempts 用 client_id 保存身份，刷题接口约定写的是 'u<userId>'
-- （见 V1 统计接口用 `client_id = 'u' + user.id` 读取），据此回填 user_id，
-- 让历史成绩在 V2 的个人中心与统计里继续可见。
UPDATE attempts
SET user_id = CAST(SUBSTR(client_id, 2) AS INTEGER)
WHERE user_id IS NULL
  AND client_id LIKE 'u%'
  AND SUBSTR(client_id, 2) GLOB '[0-9]*'
  AND CAST(SUBSTR(client_id, 2) AS INTEGER) IN (SELECT id FROM users);
