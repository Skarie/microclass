/**
 * 学习日历仓储：按天聚合「观看进度更新」与「刷题提交」。
 *
 * 只返回范围内**有活动**的日期（前端自己补空日）。日期口径是服务器本地日期：
 * SQLite 的 `date(..., 'unixepoch', 'localtime')`（学情分析的 trend 用的是 UTC 日，
 * 学习日历面向学生本人，按本地日更符合「今天学了什么」的直觉）。
 *
 * P0 阶段 2（analytics 批次）：改走 `AsyncDb`（PG 模式下不再读 SQLite）；
 * 本地日表达式由 `db/sql.ts` 的 `unixDay(..., { local: true })` 按方言生成
 * （PG → `to_char(to_timestamp(col) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`，方言 #21）。
 */
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import { unixDay } from '../sql.js';

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
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  /** 范围内有观看进度更新的日期 → 去重课时数 */
  async lessonDays(userId: number, since: number): Promise<Map<string, number>> {
    const adb = this.adb();
    const rows = await adb.all<DayCountRow>(
      `SELECT ${unixDay('updated_at', adb.driver, { local: true })} AS day,
              COUNT(DISTINCT lesson_id) AS n
       FROM lesson_progress
       WHERE user_id = ? AND updated_at >= ?
       GROUP BY day`,
      [userId, since],
    );
    return new Map(rows.map((row) => [row.day, Number(row.n)]));
  }

  /** 范围内提交过的练习次数（attempts 表：刷题判分一次记一条） */
  async quizDays(userId: number, since: number): Promise<Map<string, number>> {
    const adb = this.adb();
    const rows = await adb.all<DayCountRow>(
      `SELECT ${unixDay('created_at', adb.driver, { local: true })} AS day,
              COUNT(*) AS n
       FROM attempts
       WHERE user_id = ? AND created_at >= ?
       GROUP BY day`,
      [userId, since],
    );
    return new Map(rows.map((row) => [row.day, Number(row.n)]));
  }

  /** 合并两类活动，按日期升序（日历从左到右） */
  async daily(userId: number, since: number): Promise<ActivityDay[]> {
    const lessons = await this.lessonDays(userId, since);
    const quizzes = await this.quizDays(userId, since);
    const dates = [...new Set([...lessons.keys(), ...quizzes.keys()])].sort();
    return dates.map((date) => ({
      date,
      lessons: lessons.get(date) ?? 0,
      quizzes: quizzes.get(date) ?? 0,
    }));
  }
}
