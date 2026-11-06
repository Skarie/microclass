/**
 * 学习日历的纯计算：把 `/me/activity` 的「有活动的日期」铺成 7 列、周一开头的热力格，
 * 并算出「近 30 天学习 N 天 · 连续 M 天」。
 *
 * 只做日期与分档，不碰 DOM：网格组件拿到 cells 直接渲染。
 */
import type { ActivityDay } from '@/api/activity';

export type ActivityLevel = 0 | 1 | 2 | 3;

export interface CalendarCell {
  /** YYYY-MM-DD；窗口外补位为 null */
  date: string | null;
  lessons: number;
  quizzes: number;
  /** 0 无活动；1~3 有活动，数字越大强度越高 */
  level: ActivityLevel;
  today: boolean;
}

export interface CalendarGrid {
  cells: CalendarCell[];
  /** 网格行数（整周：通常 5 行，30 天窗口跨 6 周时是 6 行） */
  weeks: number;
  /** 窗口内实际有学习记录的天数 */
  activeDays: number;
  /** 从今天（今天还没学则从昨天）往前连续有活动的天数 */
  streak: number;
  /** 窗口内是否有任何记录 —— 决定空态文案 */
  hasActivity: boolean;
}

export function isoDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 相对今天偏移 offset 天的日期（用日期构造器，跨夏令时也安全） */
function shiftDays(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

/** 强度分档：lessons + quizzes 1~2 / 3~5 / 6+ 三档，0 为无活动 */
export function activityLevel(day: { lessons: number; quizzes: number }): ActivityLevel {
  const total = day.lessons + day.quizzes;
  if (total <= 0) return 0;
  if (total <= 2) return 1;
  if (total <= 5) return 2;
  return 3;
}

function blankCell(): CalendarCell {
  return { date: null, lessons: 0, quizzes: 0, level: 0, today: false };
}

export function buildCalendar(days: ActivityDay[], now = new Date(), span = 30): CalendarGrid {
  const byDate = new Map<string, ActivityDay>();
  for (const day of days) {
    if (day?.date) byDate.set(day.date, day);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayIso = isoDate(today);
  const start = shiftDays(today, -(span - 1));
  // 周一开头：getDay() 里周日是 0，换算出周一=0 … 周日=6
  const leading = (start.getDay() + 6) % 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < leading; i += 1) cells.push(blankCell());
  for (let i = 0; i < span; i += 1) {
    const iso = isoDate(shiftDays(start, i));
    const day = byDate.get(iso);
    const lessons = day?.lessons ?? 0;
    const quizzes = day?.quizzes ?? 0;
    cells.push({ date: iso, lessons, quizzes, level: activityLevel({ lessons, quizzes }), today: iso === todayIso });
  }
  while (cells.length % 7 !== 0) cells.push(blankCell());

  const activeDays = cells.filter((cell) => cell.date !== null && cell.level > 0).length;

  // 连续天数：从今天往前数；今天还没学不算断（从昨天接着数）
  let streak = 0;
  for (let i = 0; i < span; i += 1) {
    const day = byDate.get(isoDate(shiftDays(today, -i)));
    const level = activityLevel({ lessons: day?.lessons ?? 0, quizzes: day?.quizzes ?? 0 });
    if (level > 0) {
      streak += 1;
      continue;
    }
    if (i === 0) continue;
    break;
  }

  return { cells, weeks: cells.length / 7, activeDays, streak, hasActivity: activeDays > 0 };
}

/** 便于给格子写 title / aria：2026-11-01 → 11 月 1 日 */
export function cellLabel(cell: CalendarCell): string {
  if (!cell.date) return '';
  const [, month, day] = cell.date.split('-');
  return `${Number(month)} 月 ${Number(day)} 日`;
}
