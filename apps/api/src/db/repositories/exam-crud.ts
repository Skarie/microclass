/**
 * 考试主体（exams）的增删改查与列表统计。
 *
 * 从 examRepository 抽出。SQL 文本、排序与默认值逐字保持：
 * - 列表 `ORDER BY id DESC`（新建的排最前，与拆分前一致）；
 * - create/update 的字段顺序与默认值不变，未传的考试设置保持原值；
 * - 只有 `delete` 走物理删除（调用方负责级联清理，仓储不额外扩权）。
 *
 * P0 阶段 2（批次 2）：**读方法与写方法都走 `AsyncDb`**，全部返回 Promise。
 * - 自增改 `INSERT … RETURNING id`（不再依赖 `lastInsertRowid`）；
 * - `update`/`setStructure` 读旧值改 `await findById(adb, id)`，
 *   批次 1 留下的模块内私有同步读 `findByIdSync` 已删除（切流后不会再出现「读 SQLite、写 PG」）。
 */
import type { Exam } from '@microclass/shared';
import type { AsyncDb } from '../async.js';
import type { ExamAttempt, ExamInput, ExamWithStats } from './exam-types.js';

const SELECT_EXAM = 'SELECT * FROM exams WHERE id = ?';

/** 考试列表（按 id 倒序，新建的排最前） */
export async function listByCourse(adb: AsyncDb, courseId: number): Promise<Exam[]> {
  return adb.all<Exam>('SELECT * FROM exams WHERE course_id = ? ORDER BY id DESC', [courseId]);
}

/** 考试列表（含题量、参与人数与我的最近成绩） */
export async function listByCourseWithStats(
  adb: AsyncDb,
  courseId: number,
  viewerId: number | null,
): Promise<(ExamWithStats & { my: ExamAttempt | null })[]> {
  const exams = await listByCourse(adb, courseId);
  const out: (ExamWithStats & { my: ExamAttempt | null })[] = [];
  // 逐场统计（与拆分前同序：先考试、再题量、再参与人数、最后我的最近一次）
  for (const e of exams) {
    const questionRow = await adb.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_questions WHERE exam_id = ?', [
      e.id,
    ]);
    const attemptRow = await adb.get<{ c: number }>('SELECT COUNT(*) AS c FROM exam_attempts WHERE exam_id = ?', [
      e.id,
    ]);
    const my =
      viewerId === null
        ? null
        : ((await adb.get<ExamAttempt>(
            'SELECT * FROM exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
            [e.id, viewerId],
          )) ?? null);
    out.push({
      ...e,
      // PG 的 COUNT 是 int8，node-postgres 默认回传字符串，这里统一收成数字
      question_count: Number(questionRow?.c ?? 0),
      attempt_count: Number(attemptRow?.c ?? 0),
      my,
    });
  }
  return out;
}

export async function findById(adb: AsyncDb, id: number): Promise<Exam | undefined> {
  return adb.get<Exam>(SELECT_EXAM, [id]);
}

/** 新建考试；返回自增 id（`RETURNING id`，SQLite 3.35+ / PG 同一句 SQL） */
export async function create(adb: AsyncDb, input: ExamInput): Promise<number> {
  const row = await adb.get<{ id: number | string }>(
    `INSERT INTO exams (course_id, title, description, duration_minutes, pass_score, status, structure, difficulty_target, total_score,
                         start_at, end_at, attempt_limit, shuffle_questions, show_answers)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
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
  );
  return Number(row?.id ?? 0);
}

export async function update(adb: AsyncDb, id: number, input: ExamInput): Promise<void> {
  const existing = await findById(adb, id);
  await adb.run(
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
export async function setStructure(
  adb: AsyncDb,
  id: number,
  structure: string,
  difficultyTarget?: string,
  totalScore?: number,
): Promise<void> {
  const existing = await findById(adb, id);
  await adb.run('UPDATE exams SET structure = ?, difficulty_target = ?, total_score = ? WHERE id = ?', [
    structure,
    difficultyTarget ?? existing?.difficulty_target ?? '',
    totalScore ?? existing?.total_score ?? 100,
    id,
  ]);
}

export async function remove(adb: AsyncDb, id: number): Promise<void> {
  await adb.run('DELETE FROM exams WHERE id = ?', [id]);
}
