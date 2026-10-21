/**
 * 试卷题目（exam_questions）：卷内题目、排序、分值/大题、加题/删题/换题。
 *
 * 从 examRepository 抽出。SQL 文本、排序与事务边界逐字保持：
 * - 卷内题目 `ORDER BY eq.sort, q.id`；
 * - reorder / replaceQuestion / addQuestions 的写操作仍在单事务内完成；
 * - 批量加题「已在卷内的自动跳过」，返回实际新增数。
 */
import type { Db } from '../client.js';
import type { ExamQuestionMeta, ExamQuestionRow } from './exam-types.js';

/** 已选入试卷的题目（按卷内顺序，含大题与分值） */
export function listQuestions(db: Db, examId: number): ExamQuestionRow[] {
  return db.all<ExamQuestionRow>(
    `SELECT q.id, q.bank_id, q.lesson_id, q.type, q.stem, q.image_path, q.options, q.answer, q.analysis,
            q.difficulty, q.difficulty_score, q.point, q.book,
            eq.sort, eq.score, COALESCE(eq.section, '') AS section
     FROM exam_questions eq
     JOIN questions q ON q.id = eq.question_id
     WHERE eq.exam_id = ?
     ORDER BY eq.sort, q.id`,
    [examId],
  );
}

/** 单个题目的卷内配置（换题/改分值用） */
export function questionInExam(db: Db, examId: number, questionId: number): ExamQuestionMeta | undefined {
  return db.get<ExamQuestionMeta>(
    "SELECT sort, score, COALESCE(section, '') AS section FROM exam_questions WHERE exam_id = ? AND question_id = ?",
    [examId, questionId],
  );
}

/** 改某题的分值 / 大题分组 */
export function setQuestionMeta(
  db: Db,
  examId: number,
  questionId: number,
  meta: { score?: number; section?: string },
): void {
  if (meta.score !== undefined) {
    db.run('UPDATE exam_questions SET score = ? WHERE exam_id = ? AND question_id = ?', [
      meta.score,
      examId,
      questionId,
    ]);
  }
  if (meta.section !== undefined) {
    db.run('UPDATE exam_questions SET section = ? WHERE exam_id = ? AND question_id = ?', [
      meta.section,
      examId,
      questionId,
    ]);
  }
}

/** 重排卷内顺序（传完整 id 顺序） */
export function reorder(db: Db, examId: number, questionIds: number[]): void {
  db.transaction(() => {
    questionIds.forEach((qid, index) => {
      db.run('UPDATE exam_questions SET sort = ? WHERE exam_id = ? AND question_id = ?', [index, examId, qid]);
    });
  });
}

/** 用另一道题替换卷内某题（保持位置/分值/大题） */
export function replaceQuestion(db: Db, examId: number, oldQuestionId: number, newQuestionId: number): void {
  const current = questionInExam(db, examId, oldQuestionId);
  db.transaction(() => {
    db.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, oldQuestionId]);
    db.run('INSERT OR REPLACE INTO exam_questions (exam_id, question_id, sort, score, section) VALUES (?,?,?,?,?)', [
      examId,
      newQuestionId,
      current?.sort ?? 0,
      current?.score ?? 0,
      current?.section ?? '',
    ]);
  });
}

/** 批量加题；已在卷内的自动跳过，返回实际新增数 */
export function addQuestions(db: Db, examId: number, questionIds: number[]): number {
  let added = 0;
  const maxSort = db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM exam_questions WHERE exam_id = ?', [
    examId,
  ])?.m;
  let next = maxSort === null || maxSort === undefined ? 0 : maxSort + 1;
  db.transaction(() => {
    for (const qid of questionIds) {
      if (!db.get<{ id: number }>('SELECT id FROM questions WHERE id = ?', [qid])) continue;
      const info = db.run('INSERT OR IGNORE INTO exam_questions (exam_id, question_id, sort) VALUES (?,?,?)', [
        examId,
        qid,
        next,
      ]);
      if (info.changes > 0) {
        added += 1;
        next += 1;
      }
    }
  });
  return added;
}

export function removeQuestion(db: Db, examId: number, questionId: number): void {
  db.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, questionId]);
}

/** 把某题型的所有题统一刷成「大题名 + 每题分值」（组卷按题型生成大题用） */
export function applySection(db: Db, examId: number, type: string, sectionName: string, score: number): number {
  return db.run(
    `UPDATE exam_questions SET section = ?, score = ?
     WHERE exam_id = ?
       AND question_id IN (SELECT id FROM questions WHERE type = ?)`,
    [sectionName, score, examId, type],
  ).changes;
}

/** 清空卷内题目（智能组卷「重新生成」用） */
export function clearQuestions(db: Db, examId: number): number {
  return db.run('DELETE FROM exam_questions WHERE exam_id = ?', [examId]).changes;
}

export function questionIds(db: Db, examId: number): number[] {
  return db
    .all<{ question_id: number }>('SELECT question_id FROM exam_questions WHERE exam_id = ?', [examId])
    .map((r) => r.question_id);
}
