/**
 * 学习进度仓储：进度上报（断点续播/看完）、学习概览（时长/等级）。
 *
 * P0 阶段 2：改走 `AsyncDb`（sqlite / pg 双栈），方法全部异步。
 * `upsert` 是高频写路径（播放器每十几秒上报一次），单语句 upsert 不需要外层事务；
 * 删除用户的进度行（users 路由）也收在这里，避免跨域直接写表。
 *
 * ⚠️ 方言 #20 已收口：`finished = MAX(finished, excluded.finished)` / `quiz_best = MAX(...)` 是 SQLite 的
 * **两参标量** `max()`，PG 的 `MAX` 只有聚合形式（`MAX(a,b)` 直接报错），改用 `db/sql.ts` 的 `maxOf`：
 * sqlite 原样 `MAX(a,b)`、pg `GREATEST(a,b)`（NULL 语义差异见 `maxOf` 注释）。
 * （方言 #19 的 `unixepoch()` 已改 `nowSeconds(driver)` 方言表达式，见 `db/sql.ts`）。
 */
import { LEVELS } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import { maxOf, nowSeconds } from '../sql.js';
import type { LessonProgress } from '@microclass/shared';

export interface ProgressInput {
  userId: number;
  lessonId: number;
  position: number;
  duration: number;
  finished: boolean;
}

export interface ProgressSummary {
  minutes: number;
  finishedLessons: number;
  quizzed: number;
  level: string;
  nextMinutes: number | null;
}

export class ProgressRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async get(userId: number, lessonId: number): Promise<LessonProgress | undefined> {
    return this.adb().get<LessonProgress>('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', [
      userId,
      lessonId,
    ]);
  }

  async listByUser(userId: number): Promise<LessonProgress[]> {
    return this.adb().all<LessonProgress>('SELECT * FROM lesson_progress WHERE user_id = ? ORDER BY updated_at DESC', [
      userId,
    ]);
  }

  async upsert(input: ProgressInput): Promise<void> {
    const position = input.finished ? input.duration : Math.max(0, input.position);
    const driver = this.adb().driver;
    const now = nowSeconds(driver);
    await this.adb().run(
      `INSERT INTO lesson_progress (user_id, lesson_id, position, duration, finished, updated_at)
       VALUES (?,?,?,?,?,${now})
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET
         position = excluded.position,
         duration = excluded.duration,
         finished = ${maxOf('lesson_progress.finished', 'excluded.finished', driver)},
         updated_at = ${now}`,
      [input.userId, input.lessonId, position, Math.max(0, input.duration), input.finished ? 1 : 0],
    );
  }

  async markQuizDone(userId: number, lessonId: number, score: number): Promise<void> {
    const driver = this.adb().driver;
    const now = nowSeconds(driver);
    await this.adb().run(
      `INSERT INTO lesson_progress (user_id, lesson_id, quiz_done, quiz_best) VALUES (?,?,1,?)
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET
         quiz_done = 1,
         quiz_best = ${maxOf('lesson_progress.quiz_best', 'excluded.quiz_best', driver)},
         updated_at = ${now}`,
      [userId, lessonId, score],
    );
  }

  /** 删除某用户的全部进度（管理员删账号时清理）；返回删除行数 */
  async deleteForUser(userId: number): Promise<number> {
    const result = await this.adb().run('DELETE FROM lesson_progress WHERE user_id = ?', [userId]);
    return result.changes;
  }

  /** 学习概览：累计学习分钟（看完按整段时长、未看完按已看位置）+ 等级 */
  async summary(userId: number): Promise<ProgressSummary> {
    const rows = await this.adb().all<{ position: number; duration: number; finished: 0 | 1; quiz_done: 0 | 1 }>(
      'SELECT position, duration, finished, quiz_done FROM lesson_progress WHERE user_id = ?',
      [userId],
    );
    let seconds = 0;
    let finishedLessons = 0;
    let quizzed = 0;
    for (const r of rows) {
      // PG 的 int8/数值列可能回传字符串，统一 Number() 后再比较
      const finished = Number(r.finished) === 1;
      const quizDone = Number(r.quiz_done) === 1;
      if (finished) {
        finishedLessons++;
        seconds += Number(r.duration ?? 0);
      } else {
        seconds += Math.min(Number(r.duration ?? 0), Number(r.position ?? 0));
      }
      if (quizDone) quizzed++;
    }
    const minutes = Math.round(seconds / 60);
    let levelIndex = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      const lv = LEVELS[i];
      if (lv && minutes >= lv.minMinutes) levelIndex = i;
    }
    const current = LEVELS[levelIndex] ?? LEVELS[0];
    const next = LEVELS[levelIndex + 1];
    return {
      minutes,
      finishedLessons,
      quizzed,
      level: current?.name ?? '',
      nextMinutes: next ? next.minMinutes : null,
    };
  }
}
