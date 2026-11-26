/**
 * 课时笔记（lesson_notes）与学习统计所需的聚合查询。
 *
 * P0 阶段 2：`NoteRepository` / `StatsRepository` 都走 `AsyncDb`（sqlite / pg 双栈）；
 * `NoteRepository.create` 用 `INSERT … RETURNING id`。
 */
import type { LessonNote } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';

export interface StudentOption {
  id: number;
  username: string;
  display_name: string;
}

export interface LessonStatRow {
  id: number;
  username: string;
  display_name: string;
  watched: boolean;
  finished: boolean;
  percent: number;
  quiz_done: boolean;
  best_score: number;
  attempts: number;
  updated_at: number | null;
}

export interface LessonStatSummary {
  students: number;
  watched: number;
  finished: number;
  not_started: number;
  quizzed: number;
  not_quizzed: number;
  avg: number;
  best: number;
}

export class NoteRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async listByLesson(userId: number, lessonId: number): Promise<LessonNote[]> {
    return this.adb().all<LessonNote>(
      'SELECT id, user_id, lesson_id, pos, text, created_at FROM lesson_notes WHERE user_id = ? AND lesson_id = ? ORDER BY pos, id',
      [userId, lessonId],
    );
  }

  async findById(id: number, userId: number): Promise<LessonNote | undefined> {
    return this.adb().get<LessonNote>('SELECT * FROM lesson_notes WHERE id = ? AND user_id = ?', [id, userId]);
  }

  async create(input: { userId: number; lessonId: number; pos: number; text: string }): Promise<number> {
    const row = await this.adb().get<{ id: number | string }>(
      'INSERT INTO lesson_notes (user_id, lesson_id, pos, text) VALUES (?,?,?,?) RETURNING id',
      [input.userId, input.lessonId, input.pos, input.text],
    );
    return Number(row?.id ?? 0);
  }

  async delete(id: number, userId: number): Promise<void> {
    await this.adb().run('DELETE FROM lesson_notes WHERE id = ? AND user_id = ?', [id, userId]);
  }

  async countByLesson(userId: number, lessonId: number): Promise<number> {
    const row = await this.adb().get<{ c: number | string }>(
      'SELECT COUNT(*) AS c FROM lesson_notes WHERE user_id = ? AND lesson_id = ?',
      [userId, lessonId],
    );
    return Number(row?.c ?? 0);
  }
}

/**
 * 学习统计仓储：按学生聚合某课时的观看与刷题情况。
 *
 * 刷题次数优先按 `attempts.user_id` 统计；V1 遗留行（user_id 为空）
 * 回退用 `client_id = 'u<userId>'` 匹配，保证历史数据不丢。
 *
 * P0 阶段 2（analytics 批次）：`students`/`lessonRows` 改走 `AsyncDb` 并返回 Promise；
 * PG 的 INTEGER 列与 COUNT/MAX 都是 int8（node-postgres 回传字符串），
 * 因此在**仓储边界**统一 `Number()`（方言 #17），服务层拿到的永远是 number。
 */
export class StatsRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async students(): Promise<StudentOption[]> {
    const rows = await this.adb().all<StudentOption>(
      "SELECT id, username, display_name FROM users WHERE role = 'student' ORDER BY id",
    );
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
  }

  async lessonRows(lessonId: number): Promise<LessonStatRow[]> {
    const adb = this.adb();
    const students = await this.students();
    const rows: LessonStatRow[] = [];
    for (const s of students) {
      const p = await adb.get<{
        position: number;
        duration: number;
        finished: 0 | 1;
        quiz_done: 0 | 1;
        updated_at: number;
      }>(
        'SELECT position, duration, finished, quiz_done, updated_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?',
        [s.id, lessonId],
      );
      const best = await adb.get<{ m: number | null; c: number }>(
        `SELECT COALESCE(MAX(score), 0) AS m, COUNT(*) AS c FROM attempts
         WHERE lesson_id = ? AND (user_id = ? OR (user_id IS NULL AND client_id = ?))`,
        [lessonId, s.id, `u${s.id}`],
      );
      const position = Number(p?.position ?? 0);
      const duration = Number(p?.duration ?? 0);
      const finished = Number(p?.finished ?? 0);
      const quizDone = Number(p?.quiz_done ?? 0);
      const percent = p && duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
      rows.push({
        id: Number(s.id),
        username: s.username,
        display_name: s.display_name,
        watched: Boolean(p && (finished === 1 || position > 5)),
        finished: Boolean(p && finished === 1),
        percent,
        quiz_done: Boolean(p && quizDone === 1),
        best_score: Number(best?.m ?? 0),
        attempts: Number(best?.c ?? 0),
        updated_at: p ? Number(p.updated_at) : null,
      });
    }
    return rows;
  }

  lessonSummary(rows: LessonStatRow[]): LessonStatSummary {
    const watched = rows.filter((r) => r.watched).length;
    const finished = rows.filter((r) => r.finished).length;
    const quizzed = rows.filter((r) => r.quiz_done).length;
    const scores = rows.filter((r) => r.quiz_done && r.best_score > 0).map((r) => r.best_score);
    const avg = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    return {
      students: rows.length,
      watched,
      finished,
      not_started: rows.length - watched,
      quizzed,
      not_quizzed: rows.length - quizzed,
      avg,
      best: scores.length > 0 ? Math.max(...scores) : 0,
    };
  }
}
