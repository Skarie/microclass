/**
 * 考试主体（exams）的增删改查与列表统计。
 *
 * 从 examRepository 抽出。SQL 文本、排序与默认值逐字保持：
 * - 列表 `ORDER BY id DESC`（新建的排最前，与拆分前一致）；
 * - create/update 的字段顺序与默认值不变，未传的考试设置保持原值；
 * - 只有 `delete` 走物理删除（调用方负责级联清理，仓储不额外扩权）。
 */
import type { Exam } from '@microclass/shared';
import type { Db } from '../client.js';
import type { ExamAttempt, ExamInput, ExamWithStats } from './exam-types.js';

export function listByCourse(db: Db, courseId: number): Exam[] {
  return db.all<Exam>('SELECT * FROM exams WHERE course_id = ? ORDER BY id DESC', [courseId]);
}

/** 考试列表（含题量、参与人数与我的最近成绩） */
export function listByCourseWithStats(
  db: Db,
  courseId: number,
  viewerId: number | null,
): (ExamWithStats & { my: ExamAttempt | null })[] {
  return listByCourse(db, courseId).map((e) => {
    const questionCount =
      db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_questions WHERE exam_id = ?', [e.id])?.c ?? 0;
    const attemptCount =
      db.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ?', [e.id])?.c ?? 0;
    const my =
      viewerId === null
        ? null
        : (db.get<ExamAttempt>(
            'SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
            [e.id, viewerId],
          ) ?? null);
    return { ...e, question_count: questionCount, attempt_count: attemptCount, my };
  });
}

export function findById(db: Db, id: number): Exam | undefined {
  return db.get<Exam>('SELECT * FROM exams WHERE id = ?', [id]);
}

export function create(db: Db, input: ExamInput): number {
  return db.run(
    `INSERT INTO exams (course_id, title, description, duration_minutes, pass_score, status, structure, difficulty_target, total_score,
                         start_at, end_at, attempt_limit, shuffle_questions, show_answers)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.courseId,
      input.title,
      input.description ?? '',
      input.durationMinutes ?? 60,
      input.passScore ?? 60,
      input.status ?? 'draft',
      input.structure ?? '[]',
      input.difficultyTarget ?? '',
      input.totalScore ?? 100,
      input.startAt ?? 0,
      input.endAt ?? 0,
      input.attemptLimit ?? 0,
      input.shuffleQuestions ? 1 : 0,
      input.showAnswers === false ? 0 : 1,
    ],
  ).lastInsertRowid;
}

export function update(db: Db, id: number, input: ExamInput): void {
  const existing = findById(db, id);
  db.run(
    `UPDATE exams SET course_id = ?, title = ?, description = ?, duration_minutes = ?, pass_score = ?, status = ?,
       structure = ?, difficulty_target = ?, total_score = ?,
       start_at = ?, end_at = ?, attempt_limit = ?, shuffle_questions = ?, show_answers = ?
     WHERE id = ?`,
    [
      input.courseId,
      input.title,
      input.description ?? '',
      input.durationMinutes ?? 60,
      input.passScore ?? 60,
      input.status ?? 'draft',
      input.structure ?? existing?.structure ?? '[]',
      input.difficultyTarget ?? existing?.difficulty_target ?? '',
      input.totalScore ?? existing?.total_score ?? 100,
      // 考试设置：不传即保持原值（表单里没动的项不能被重置）
      input.startAt ?? existing?.start_at ?? 0,
      input.endAt ?? existing?.end_at ?? 0,
      input.attemptLimit ?? existing?.attempt_limit ?? 0,
      (input.shuffleQuestions ?? Boolean(existing?.shuffle_questions)) ? 1 : 0,
      (input.showAnswers ?? (existing?.show_answers === undefined ? true : Boolean(existing.show_answers))) ? 1 : 0,
      id,
    ],
  );
}

/** 只更新试卷结构/目标配比（组卷工作台里改大题、分值） */
export function setStructure(
  db: Db,
  id: number,
  structure: string,
  difficultyTarget?: string,
  totalScore?: number,
): void {
  const existing = findById(db, id);
  db.run('UPDATE exams SET structure = ?, difficulty_target = ?, total_score = ? WHERE id = ?', [
    structure,
    difficultyTarget ?? existing?.difficulty_target ?? '',
    totalScore ?? existing?.total_score ?? 100,
    id,
  ]);
}

export function remove(db: Db, id: number): void {
  db.run('DELETE FROM exams WHERE id = ?', [id]);
}
