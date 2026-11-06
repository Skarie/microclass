/**
 * 学习日历：`GET /me/activity?days=30`
 *
 * 返回最近 `days` 个日历日（含今天）里**有活动**的日期：
 * - `lessons`：当天有观看进度更新的课时数（lesson_progress.updated_at 去重）；
 * - `quizzes`：当天提交的练习次数（attempts.created_at 计数）。
 *
 * 日期口径是服务器本地日期（SQL 里 `localtime`）；前端拿到的 `date` 可直接补空日画日历。
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '@microclass/shared';
import { requireUser } from '../http/guards.js';
import type { Deps } from '../app.js';
import { ActivityRepository } from '../db/repositories/activityRepository.js';

const DAYS_DEFAULT = 30;
const DAYS_MIN = 1;
const DAYS_MAX = 90;

/** 本地时区下「今天往前 days-1 天」的零点（秒级时间戳），作为查询下界 */
function startOfWindow(days: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return Math.floor(start.getTime() / 1000);
}

function parseDays(raw: unknown): number {
  if (raw === undefined || raw === '') return DAYS_DEFAULT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw AppError.badRequest('days 必须是 1~90 的整数');
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < DAYS_MIN || days > DAYS_MAX) {
    throw AppError.badRequest(`days 必须是 ${DAYS_MIN}~${DAYS_MAX} 的整数`);
  }
  return days;
}

export async function registerActivityRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const activity = new ActivityRepository(deps.db);

  app.get('/me/activity', async (req, reply) => {
    const user = requireUser(req, reply);
    const days = parseDays((req.query as { days?: unknown }).days);
    const rows = activity.daily(user.id, startOfWindow(days));
    return { days: rows.map((row) => ({ ...row, active: row.lessons > 0 || row.quizzes > 0 })) };
  });
}
