/**
 * 刷题记录（attempts）与错题本（wrong_questions）仓储。
 */
import type { WrongQuestion } from '@microclass/shared';
import type { Db } from '../client.js';

export interface Attempt {
  id: number;
  client_id: string;
  lesson_id: number;
  user_id: number | null;
  answers: string;
  score: number;
  total: number;
  created_at: number;
}

export interface AttemptInput {
  userId: number;
  clientId: string;
  lessonId: number;
  answers: unknown;
  score: number;
  total: number;
}

export interface WrongQuestionRow extends WrongQuestion {
  lesson_id: number | null;
  bank_id: number;
  type: string;
  stem: string;
  image_path: string;
  options: string;
  answer: string;
  analysis: string;
}

export class AttemptRepository {
  constructor(private readonly db: Db) {}

  create(input: AttemptInput): number {
    return this.db.run(
      'INSERT INTO attempts (client_id, user_id, lesson_id, answers, score, total) VALUES (?,?,?,?,?,?)',
      [input.clientId, input.userId, input.lessonId, JSON.stringify(input.answers), input.score, input.total],
    ).lastInsertRowid;
  }

  listByUser(userId: number, options?: { lessonId?: number; limit?: number }): Attempt[] {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (options?.lessonId !== undefined) {
      clauses.push('lesson_id = ?');
      params.push(options.lessonId);
    }
    params.push(options?.limit ?? 50);
    return this.db.all<Attempt>(
      `SELECT * FROM attempts WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
  }

  /**
   * 历史最好成绩，**按百分比**返回（0-100）。
   * 随机抽题会让每次 attempt 的总题数不同，比较原始分没有意义；
   * 该口径与 lesson_progress.quiz_best 一致。
   */
  bestPercent(userId: number, lessonId: number): number {
    const row = this.db.get<{ best: number | null }>(
      `SELECT MAX(CASE WHEN total > 0 THEN score * 100.0 / total ELSE 0 END) AS best
       FROM attempts WHERE user_id = ? AND lesson_id = ?`,
      [userId, lessonId],
    );
    return Math.round(row?.best ?? 0);
  }

  countByLesson(lessonId: number): number {
    return this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM attempts WHERE lesson_id = ?', [lessonId])?.c ?? 0;
  }
}

export class WrongQuestionRepository {
  constructor(private readonly db: Db) {}

  /** 答错：次数 +1 并重新标记为未掌握 */
  upsertWrong(userId: number, questionId: number): void {
    this.db.run(
      `INSERT INTO wrong_questions (user_id, question_id, wrong_count, mastered, last_at)
       VALUES (?,?,1,0,unixepoch())
       ON CONFLICT(user_id, question_id)
       DO UPDATE SET wrong_count = wrong_count + 1, mastered = 0, last_at = unixepoch()`,
      [userId, questionId],
    );
  }

  /** 答对：把未掌握的错题标记为已掌握 */
  markMastered(userId: number, questionId: number): void {
    this.db.run(
      'UPDATE wrong_questions SET mastered = 1, last_at = unixepoch() WHERE user_id = ? AND question_id = ? AND mastered = 0',
      [userId, questionId],
    );
  }

  setMastered(userId: number, questionId: number, mastered: boolean): void {
    this.db.run(
      'UPDATE wrong_questions SET mastered = ?, last_at = unixepoch() WHERE user_id = ? AND question_id = ?',
      [mastered ? 1 : 0, userId, questionId],
    );
  }

  remove(userId: number, questionId: number): void {
    this.db.run('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?', [userId, questionId]);
  }

  /** 错题列表（含题目内容），按最近错误时间倒序 */
  list(userId: number, options?: { lessonId?: number; includeMastered?: boolean; limit?: number }): WrongQuestionRow[] {
    const clauses = ['w.user_id = ?'];
    const params: unknown[] = [userId];
    if (!options?.includeMastered) clauses.push('w.mastered = 0');
    if (options?.lessonId !== undefined) {
      clauses.push('(q.lesson_id = ? OR b.lesson_id = ?)');
      params.push(options.lessonId, options.lessonId);
    }
    params.push(options?.limit ?? 200);
    return this.db.all<WrongQuestionRow>(
      `SELECT w.*, q.lesson_id, q.bank_id, q.type, q.stem, q.image_path, q.options, q.answer, q.analysis
       FROM wrong_questions w
       JOIN questions q ON q.id = w.question_id
       LEFT JOIN banks b ON b.id = q.bank_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY w.last_at DESC, w.question_id
       LIMIT ?`,
      params,
    );
  }

  count(userId: number): { total: number; pending: number } {
    const row = this.db.get<{ total: number; pending: number | null }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) AS pending
       FROM wrong_questions WHERE user_id = ?`,
      [userId],
    );
    // 无记录时 SUM 返回 NULL，统一收敛为 0
    return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
  }
}
