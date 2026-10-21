/**
 * 作答与成绩（exam_attempts）：作答次数、最近一次作答、交卷落库、成绩单。
 *
 * 从 examRepository 抽出。SQL 文本与排序语义逐字保持：
 * - 成绩单 `ORDER BY score DESC, used_seconds ASC, id`（同分用时少者靠前、再按 id）；
 * - 个人成绩 `ORDER BY created_at DESC, id DESC`；
 * - 排序规则抽成纯函数 `compareAttemptRank()`，便于单测锁住口径。
 *
 * 作答行只存 {qid, given, correct, score} 四元组；题干/答案在取卷时按 question_id 回表，
 * 避免题库改题后历史成绩串味（与 exam-grading 的缓存卷面口径一致）。
 */
import type { Db } from '../client.js';
import type { AttemptInput, ExamAttempt } from './exam-types.js';

/** 成绩单行：作答 + 学生信息 */
export type AttemptWithStudent = ExamAttempt & { username: string; display_name: string };
/** 个人中心行：作答 + 考试/课程信息 */
export type AttemptWithExam = ExamAttempt & { exam_title: string; course_id: number; course_name: string };

/** 参与成绩排序的最小列集合（成绩单行 / 个人成绩行都满足） */
export type RankableAttempt = Pick<ExamAttempt, 'id' | 'score' | 'used_seconds'>;

/** 成绩排序规则（纯函数）：分数高者靠前；同分用时少者靠前；再按 id 升序 */
export function compareAttemptRank(a: RankableAttempt, b: RankableAttempt): number {
  return b.score - a.score || a.used_seconds - b.used_seconds || a.id - b.id;
}

/**
 * 按成绩规则排序（纯函数，返回新数组，不改入参）。
 * SQL 已经按同一口径排序，这里再排一次是为了在内存合并/二次筛选后仍保持口径一致。
 */
export function rankAttempts<T extends RankableAttempt>(rows: readonly T[]): T[] {
  return [...rows].sort(compareAttemptRank);
}

/** 成绩单汇总结构（字段名与 API 返回一致） */
export interface AttemptSummary {
  attempts: number;
  passed: number;
  pass_rate: number;
  avg: number;
  best: number;
  worst: number;
  avg_seconds: number;
}

/**
 * 成绩单汇总（纯函数）：平均分/及格率保留 1 位小数、平均用时取整。
 * 统计口径与拆分前逐字一致，空成绩单全部返回 0（不产生 NaN）。
 */
export function summarizeAttempts(
  rows: readonly Pick<ExamAttempt, 'score' | 'passed' | 'used_seconds'>[],
): AttemptSummary {
  const scores = rows.map((r) => r.score);
  const passedCount = rows.filter((r) => r.passed === 1).length;
  const avg = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
  const avgSeconds = rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.used_seconds, 0) / rows.length) : 0;
  return {
    attempts: rows.length,
    passed: passedCount,
    pass_rate: rows.length > 0 ? Math.round((passedCount / rows.length) * 1000) / 10 : 0,
    avg,
    best: scores.length > 0 ? Math.max(...scores) : 0,
    worst: scores.length > 0 ? Math.min(...scores) : 0,
    avg_seconds: avgSeconds,
  };
}

/** 该学员在这场考试上的作答次数（学习通式"允许作答次数"要用） */
export function attemptCount(db: Db, examId: number, userId: number): number {
  return (
    db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ? AND user_id = ?', [examId, userId])
      ?.c ?? 0
  );
}

/** 最近一次作答（学习通式"只保留一条成绩"的判重入口） */
export function findAttempt(db: Db, examId: number, userId: number): ExamAttempt | undefined {
  return db.get<ExamAttempt>('SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [
    examId,
    userId,
  ]);
}

/**
 * 交卷落库参数（纯函数）：answers JSON 序列化，passed 布尔 → 0/1。
 * 抽出来便于单测锁住「只落四元组、布尔映射」的落库口径。
 */
export function attemptInsertParams(input: AttemptInput): unknown[] {
  return [
    input.examId,
    input.userId,
    JSON.stringify(input.answers),
    input.score,
    input.total,
    input.passed ? 1 : 0,
    input.usedSeconds,
  ];
}

/** 交卷落库：answers 由服务层筛成 {qid, given, correct, score} 四元组后 JSON 序列化 */
export function createAttempt(db: Db, input: AttemptInput): number {
  return db.run(
    'INSERT INTO exam_attempts (exam_id, user_id, answers, score, total, passed, used_seconds) VALUES (?,?,?,?,?,?,?)',
    attemptInsertParams(input),
  ).lastInsertRowid;
}

/** 成绩单：某场考试的全部作答（含学生信息与统计） */
export function attemptsOf(db: Db, examId: number): AttemptWithStudent[] {
  const rows = db.all<AttemptWithStudent>(
    `SELECT a.*, u.username, u.display_name
     FROM exam_attempts a
     JOIN users u ON u.id = a.user_id
     WHERE a.exam_id = ?
     ORDER BY a.score DESC, a.used_seconds ASC, a.id`,
    [examId],
  );
  return rankAttempts(rows);
}

/** 我的所有考试成绩（个人中心用） */
export function attemptsByUser(db: Db, userId: number): AttemptWithExam[] {
  return db.all<AttemptWithExam>(
    `SELECT a.*, e.title AS exam_title, e.course_id, COALESCE(c.name, '') AS course_name
     FROM exam_attempts a
     JOIN exams e ON e.id = a.exam_id
     LEFT JOIN courses c ON c.id = e.course_id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    [userId],
  );
}
