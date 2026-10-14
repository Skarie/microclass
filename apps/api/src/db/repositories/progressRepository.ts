/**
 * 学习进度仓储：进度上报（断点续播/看完）、学习概览（时长/等级）。
 */
import { LEVELS } from '@microclass/shared';
import type { Db } from '../client.js';
import type { LessonProgress } from '@microclass/shared';

export interface ProgressInput {
  userId: number;
  lessonId: number;
  position: number;
  duration: number;
  finished: boolean;
}

export class ProgressRepository {
  constructor(private readonly db: Db) {}

  get(userId: number, lessonId: number): LessonProgress | undefined {
    return this.db.get<LessonProgress>('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?', [
      userId,
      lessonId,
    ]);
  }

  listByUser(userId: number): LessonProgress[] {
    return this.db.all<LessonProgress>('SELECT * FROM lesson_progress WHERE user_id = ? ORDER BY updated_at DESC', [
      userId,
    ]);
  }

  upsert(input: ProgressInput): void {
    const position = input.finished ? input.duration : Math.max(0, input.position);
    this.db.run(
      `INSERT INTO lesson_progress (user_id, lesson_id, position, duration, finished, updated_at)
       VALUES (?,?,?,?,?,unixepoch())
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET
         position = excluded.position,
         duration = excluded.duration,
         finished = MAX(finished, excluded.finished),
         updated_at = unixepoch()`,
      [input.userId, input.lessonId, position, Math.max(0, input.duration), input.finished ? 1 : 0],
    );
  }

  markQuizDone(userId: number, lessonId: number, score: number): void {
    this.db.run(
      `INSERT INTO lesson_progress (user_id, lesson_id, quiz_done, quiz_best) VALUES (?,?,1,?)
       ON CONFLICT(user_id, lesson_id) DO UPDATE SET
         quiz_done = 1,
         quiz_best = MAX(quiz_best, excluded.quiz_best),
         updated_at = unixepoch()`,
      [userId, lessonId, score],
    );
  }

  /** 学习概览：累计学习分钟（看完按整段时长、未看完按已看位置）+ 等级 */
  summary(userId: number): {
    minutes: number;
    finishedLessons: number;
    quizzed: number;
    level: string;
    nextMinutes: number | null;
  } {
    const rows = this.db.all<{ position: number; duration: number; finished: 0 | 1; quiz_done: 0 | 1 }>(
      'SELECT position, duration, finished, quiz_done FROM lesson_progress WHERE user_id = ?',
      [userId],
    );
    let seconds = 0;
    let finishedLessons = 0;
    let quizzed = 0;
    for (const r of rows) {
      if (r.finished === 1) {
        finishedLessons++;
        seconds += r.duration ?? 0;
      } else {
        seconds += Math.min(r.duration ?? 0, r.position ?? 0);
      }
      if (r.quiz_done === 1) quizzed++;
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
