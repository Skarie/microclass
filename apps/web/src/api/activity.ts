/**
 * 学习日历：`GET /me/activity?days=30`。
 *
 * 后端只返回**有活动**的日期（`active: true`），前端按 30 天窗口自己补空格；
 * `date` 是本地日期字符串 `YYYY-MM-DD`，不要用 `new Date(iso)` 解析（会被当成 UTC 零点）。
 */
export interface ActivityDay {
  /** YYYY-MM-DD */
  date: string;
  /** 当天完成的课时数 */
  lessons: number;
  /** 当天完成的练习次数 */
  quizzes: number;
  active: boolean;
}

export interface ActivityResponse {
  days: ActivityDay[];
}
