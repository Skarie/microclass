/**
 * 刷题记录（attempts）与错题本（wrong_questions）仓储。
 *
 * P0 阶段 2（exams/attempts 批次 2）：改走 `AsyncDb`（sqlite / pg 双栈）。
 * - 自增改 `INSERT … RETURNING id`（不再用 `lastInsertRowid`）；
 * - `recordSubmission` 把「attempt 落库 + 错题本 upsert/标记掌握」放进**同一个事务**：
 *   判分是纯内存计算，落库必须要么都成功、要么都不写；
 * - 方言 #19：`unixepoch()` 换成按驱动生成的方言表达式（`db/sql.ts` 的 `nowSeconds`），
 *   两库都落整数秒，历史数据不用改；
 * - 方言 #17：`COUNT/SUM` 在 PG 是 int8（回字符串），在读边界统一 `Number()`。
 */
import type { WrongQuestion } from '@microclass/shared';
import type { Db } from '../client.js';
import { createSqliteAsyncDb, type AsyncDb } from '../async.js';
import { nowSeconds } from '../sql.js';

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

/**
 * 错题本效果（由服务层按判分结果算好）：
 * - `wrong: true`  → 答错：次数 +1、重新标记未掌握；
 * - `wrong: false` → 答对：把未掌握的错题标记为已掌握。
 * 简答题（`correct === null`）不进这个数组。
 */
export interface WrongBookEffect {
  questionId: number;
  wrong: boolean;
}

/** 落库 attempts 行（调用方负责事务边界） */
async function insertAttempt(adb: AsyncDb, input: AttemptInput): Promise<number> {
  const row = await adb.get<{ id: number | string }>(
    'INSERT INTO attempts (client_id, user_id, lesson_id, answers, score, total) VALUES (?,?,?,?,?,?) RETURNING id',
    [input.clientId, input.userId, input.lessonId, JSON.stringify(input.answers), input.score, input.total],
  );
  return Number(row?.id ?? 0);
}

/** 答错：次数 +1 并重新标记为未掌握（调用方负责事务边界） */
async function upsertWrongRow(adb: AsyncDb, userId: number, questionId: number): Promise<void> {
  const now = nowSeconds(adb.driver);
  // 方言 #30：`ON CONFLICT DO UPDATE` 的 SET 里裸列名在 PG 侧是**歧义引用**
  // （`column reference "wrong_count" is ambiguous`，SQLite 会解析成「已有行」），必须写全表名。
  await adb.run(
    `INSERT INTO wrong_questions (user_id, question_id, wrong_count, mastered, last_at)
     VALUES (?,?,1,0,${now})
     ON CONFLICT(user_id, question_id)
     DO UPDATE SET wrong_count = wrong_questions.wrong_count + 1, mastered = 0, last_at = ${now}`,
    [userId, questionId],
  );
}

/** 答对：把未掌握的错题标记为已掌握（调用方负责事务边界） */
async function markMasteredRow(adb: AsyncDb, userId: number, questionId: number): Promise<void> {
  const now = nowSeconds(adb.driver);
  await adb.run(
    `UPDATE wrong_questions SET mastered = 1, last_at = ${now}
     WHERE user_id = ? AND question_id = ? AND mastered = 0`,
    [userId, questionId],
  );
}

export class AttemptRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  async create(input: AttemptInput): Promise<number> {
    return insertAttempt(this.adb(), input);
  }

  /**
   * 交卷（刷题）：attempt 落库 + 错题本更新在**同一个事务**内。
   * 错题本写失败时 attempt 不能留下（否则学生看到成绩、错题本却没记上），
   * 反之 attempt 写失败也不能只把错题本改掉。
   */
  async recordSubmission(input: AttemptInput, wrongEffects: WrongBookEffect[]): Promise<number> {
    return this.adb().transaction(async (tx) => {
      const attemptId = await insertAttempt(tx, input);
      for (const effect of wrongEffects) {
        if (effect.wrong) await upsertWrongRow(tx, input.userId, effect.questionId);
        else await markMasteredRow(tx, input.userId, effect.questionId);
      }
      return attemptId;
    });
  }

  async listByUser(userId: number, options?: { lessonId?: number; limit?: number }): Promise<Attempt[]> {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (options?.lessonId !== undefined) {
      clauses.push('lesson_id = ?');
      params.push(options.lessonId);
    }
    params.push(options?.limit ?? 50);
    return this.adb().all<Attempt>(
      `SELECT * FROM attempts WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
  }

  /**
   * 历史最好成绩，**按百分比**返回（0-100）。
   * 随机抽题会让每次 attempt 的总题数不同，比较原始分没有意义；
   * 该口径与 lesson_progress.quiz_best 一致。
   */
  async bestPercent(userId: number, lessonId: number): Promise<number> {
    const row = await this.adb().get<{ best: number | string | null }>(
      `SELECT MAX(CASE WHEN total > 0 THEN score * 100.0 / total ELSE 0 END) AS best
       FROM attempts WHERE user_id = ? AND lesson_id = ?`,
      [userId, lessonId],
    );
    return Math.round(Number(row?.best ?? 0));
  }

  async countByLesson(lessonId: number): Promise<number> {
    const row = await this.adb().get<{ c: number | string }>('SELECT COUNT(*) AS c FROM attempts WHERE lesson_id = ?', [
      lessonId,
    ]);
    return Number(row?.c ?? 0);
  }
}

export class WrongQuestionRepository {
  constructor(
    private readonly db: Db,
    private readonly asyncDb?: AsyncDb,
  ) {}

  private adb(): AsyncDb {
    return this.asyncDb ?? createSqliteAsyncDb(this.db);
  }

  /** 答错：次数 +1 并重新标记为未掌握 */
  async upsertWrong(userId: number, questionId: number): Promise<void> {
    await upsertWrongRow(this.adb(), userId, questionId);
  }

  /** 答对：把未掌握的错题标记为已掌握 */
  async markMastered(userId: number, questionId: number): Promise<void> {
    await markMasteredRow(this.adb(), userId, questionId);
  }

  async setMastered(userId: number, questionId: number, mastered: boolean): Promise<void> {
    const now = nowSeconds(this.adb().driver);
    await this.adb().run(
      `UPDATE wrong_questions SET mastered = ?, last_at = ${now} WHERE user_id = ? AND question_id = ?`,
      [mastered ? 1 : 0, userId, questionId],
    );
  }

  async remove(userId: number, questionId: number): Promise<void> {
    await this.adb().run('DELETE FROM wrong_questions WHERE user_id = ? AND question_id = ?', [userId, questionId]);
  }

  /** 错题列表（含题目内容），按最近错误时间倒序 */
  async list(
    userId: number,
    options?: { lessonId?: number; includeMastered?: boolean; limit?: number },
  ): Promise<WrongQuestionRow[]> {
    const clauses = ['w.user_id = ?'];
    const params: unknown[] = [userId];
    if (!options?.includeMastered) clauses.push('w.mastered = 0');
    if (options?.lessonId !== undefined) {
      clauses.push('(q.lesson_id = ? OR b.lesson_id = ?)');
      params.push(options.lessonId, options.lessonId);
    }
    params.push(options?.limit ?? 200);
    const rows = await this.adb().all<WrongQuestionRow>(
      `SELECT w.*, q.lesson_id, q.bank_id, q.type, q.stem, q.image_path, q.options, q.answer, q.analysis
       FROM wrong_questions w
       JOIN questions q ON q.id = w.question_id
       LEFT JOIN banks b ON b.id = q.bank_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY w.last_at DESC, w.question_id
       LIMIT ?`,
      params,
    );
    // PG 的整数列在生成 DDL 里是 bigint，node-postgres 回字符串（方言 #17）
    return rows.map((r) => ({
      ...r,
      wrong_count: Number(r.wrong_count),
      mastered: Number(r.mastered) === 1 ? 1 : 0,
      last_at: Number(r.last_at),
    }));
  }

  async count(userId: number): Promise<{ total: number; pending: number }> {
    const row = await this.adb().get<{ total: number | string; pending: number | string | null }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) AS pending
       FROM wrong_questions WHERE user_id = ?`,
      [userId],
    );
    // 无记录时 SUM 返回 NULL，统一收敛为 0
    return { total: Number(row?.total ?? 0), pending: Number(row?.pending ?? 0) };
  }
}
