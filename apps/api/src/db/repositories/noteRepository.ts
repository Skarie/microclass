/**
 * 课时笔记（lesson_notes）与学习统计所需的聚合查询。
 */
import type { LessonNote } from '@microclass/shared';
import type { Db } from '../client.js';

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
  constructor(private readonly db: Db) {}

  listByLesson(userId: number, lessonId: number): LessonNote[] {
    return this.db.all<LessonNote>(
      'SELECT id, user_id, lesson_id, pos, text, created_at FROM lesson_notes WHERE user_id = ? AND lesson_id = ? ORDER BY pos, id',
      [userId, lessonId],
    );
  }

  findById(id: number, userId: number): LessonNote | undefined {
    return this.db.get<LessonNote>('SELECT * FROM lesson_notes WHERE id = ? AND user_id = ?', [id, userId]);
  }

  create(input: { userId: number; lessonId: number; pos: number; text: string }): number {
    return this.db.run('INSERT INTO lesson_notes (user_id, lesson_id, pos, text) VALUES (?,?,?,?)', [
      input.userId,
      input.lessonId,
      input.pos,
      input.text,
    ]).lastInsertRowid;
  }

  delete(id: number, userId: number): void {
    this.db.run('DELETE FROM lesson_notes WHERE id = ? AND user_id = ?', [id, userId]);
  }

  countByLesson(userId: number, lessonId: number): number {
    return (
      this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM lesson_notes WHERE user_id = ? AND lesson_id = ?', [
        userId,
        lessonId,
      ])?.c ?? 0
    );
  }
}

/**
 * 学习统计仓储：按学生聚合某课时的观看与刷题情况。
 *
 * 刷题次数优先按 `attempts.user_id` 统计；V1 遗留行（user_id 为空）
 * 回退用 `client_id = 'u<userId>'` 匹配，保证历史数据不丢。
 */
export class StatsRepository {
  constructor(private readonly db: Db) {}

  students(): StudentOption[] {
    return this.db.all<StudentOption>(
      "SELECT id, username, display_name FROM users WHERE role = 'student' ORDER BY id",
    );
  }

  lessonRows(lessonId: number): LessonStatRow[] {
    return this.students().map((s) => {
      const p = this.db.get<{
        position: number;
        duration: number;
        finished: 0 | 1;
        quiz_done: 0 | 1;
        updated_at: number;
      }>(
        'SELECT position, duration, finished, quiz_done, updated_at FROM lesson_progress WHERE user_id = ? AND lesson_id = ?',
        [s.id, lessonId],
      );
      const best = this.db.get<{ m: number | null; c: number }>(
        `SELECT COALESCE(MAX(score), 0) AS m, COUNT(*) AS c FROM attempts
         WHERE lesson_id = ? AND (user_id = ? OR (user_id IS NULL AND client_id = ?))`,
        [lessonId, s.id, `u${s.id}`],
      );
      const percent = p && p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
      return {
        id: s.id,
        username: s.username,
        display_name: s.display_name,
        watched: Boolean(p && (p.finished === 1 || p.position > 5)),
        finished: Boolean(p && p.finished === 1),
        percent,
        quiz_done: Boolean(p && p.quiz_done === 1),
        best_score: best?.m ?? 0,
        attempts: best?.c ?? 0,
        updated_at: p ? p.updated_at : null,
      };
    });
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
