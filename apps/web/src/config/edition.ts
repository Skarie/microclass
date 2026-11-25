/**
 * 构建版本（构建期由 vite define 注入，见 vite.config.ts）：
 *   full    —— 完整版（Docker 生产，含教学/题库/系统管理）
 *   student —— 学生端（fnOS 应用）：只暴露学员视图，管理端仍在 Docker 版里
 *
 * 用途：fnOS 上给学生的应用不该出现「题库管理 / 学员与账号 / 系统设置」，
 * 学生端把面板固定为学员视图并拦截 /admin 路由。
 */
export const APP_EDITION = __APP_EDITION__;

export const IS_STUDENT_EDITION = APP_EDITION === 'student';
