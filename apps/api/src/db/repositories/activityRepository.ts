/**
 * 学习日历仓储：按天聚合「观看进度更新」与「刷题提交」。
 *
 * 只返回范围内**有活动**的日期（前端自己补空日）。日期口径是服务器本地日期：
 * `date(..., 'unixepoch', 'localtime')`（学情分析的 trend 用的是 UTC 日，
 * 学习日历面向学生本人，按本地日更符合「今天学了什么」的直觉）。
 */
import type { Db } from '../client.js';

export interface ActivityDay {
  date: string;
  lessons: number;
  quizzes: number;
}

interface DayCountRow {
  day: string;
  n: number;
}

export class ActivityRepository {
  constructor(private readonly db: Db) {}

  /** 范围内有观看进度更新的日期 → 去重课时数 */
  lessonDays(userId: number, since: number): Map<string, number> {
    const rows = this.db.all<DayCountRow>(
      `SELECT date(updated_at, 'unixepoch', 'localtime') AS day,
              COUNT(DISTINCT lesson_id) AS n
       FROM lesson_progress
       WHERE user_id = ? AND updated_at >= ?
       GROUP BY day`,
      [userId, since],
    );
    return new Map(rows.map((row) => [row.day, Number(row.n)]));
  }

  /** 范围内提交过的练习次数（attempts 表：刷题判分一次记一条） */
  quizDays(userId: number, since: number): Map<string, number> {
    const rows = this.db.all<DayCountRow>(
      `SELECT date(created_at, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS n
       FROM attempts
       WHERE user_id = ? AND created_at >= ?
       GROUP BY day`,
      [userId, since],
    );
    return new Map(rows.map((row) => [row.day, Number(row.n)]));
  }

  /** 合并两类活动，按日期升序（日历从左到右） */
  daily(userId: number, since: number): ActivityDay[] {
    const lessons = this.lessonDays(userId, since);
    const quizzes = this.quizDays(userId, since);
    const dates = [...new Set([...lessons.keys(), ...quizzes.keys()])].sort();
    return dates.map((date) => ({
      date,
      lessons: lessons.get(date) ?? 0,
      quizzes: quizzes.get(date) ?? 0,
    }));
  }
}
