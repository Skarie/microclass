/**
 * 试卷题目（exam_questions）：卷内题目、排序、分值/大题、加题/删题/换题。
 *
 * 从 examRepository 抽出。SQL 文本、排序与事务边界逐字保持：
 * - 卷内题目 `ORDER BY eq.sort, q.id`；
 * - reorder / replaceQuestion / addQuestions / 组卷落库仍在单事务内完成；
 * - 批量加题「已在卷内的自动跳过」，返回实际新增数。
 *
 * P0 阶段 2（批次 2）：读方法与写方法都走 `AsyncDb`，多语句写改
 * `AsyncDb.transaction(async tx)`，事务内的语句一律用 `tx`。
 *
 * 方言 #22（`INSERT OR IGNORE` / `INSERT OR REPLACE` → `ON CONFLICT`）：
 * - `addQuestions` 去重加题 → `ON CONFLICT (exam_id, question_id) DO NOTHING`
 *   （SQLite 与 PG 同语义，`changes > 0` 仍表示「真的新增」）；
 * - `replaceQuestion` 保持卷内位置 → 先 `DELETE` 旧题，再
 *   `ON CONFLICT (exam_id, question_id) DO UPDATE` 覆盖同 id 行（等价于原 `REPLACE`）。
 *
 * `applyComposition` 是「组卷」的原子落库：清空（可选）+ 批量加题 + 逐题写分值/大题
 * 在**同一个事务**里，中途失败整批回滚（见 `test/exam-write-transaction.test.ts`）。
 */
import type { AsyncDb } from '../async.js';
import type { ExamQuestionMeta, ExamQuestionRow } from './exam-types.js';

const QUESTION_IN_EXAM_SQL =
  "SELECT sort, score, COALESCE(section, '') AS section FROM exam_questions WHERE exam_id = ? AND question_id = ?";

/** 已选入试卷的题目（按卷内顺序，含大题与分值） */
export async function listQuestions(adb: AsyncDb, examId: number): Promise<ExamQuestionRow[]> {
  return adb.all<ExamQuestionRow>(
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
export async function questionInExam(
  adb: AsyncDb,
  examId: number,
  questionId: number,
): Promise<ExamQuestionMeta | undefined> {
  return adb.get<ExamQuestionMeta>(QUESTION_IN_EXAM_SQL, [examId, questionId]);
}

/** 写取某个题目的分值/大题（调用方负责事务边界） */
async function writeQuestionMeta(
  adb: AsyncDb,
  examId: number,
  questionId: number,
  meta: { score?: number; section?: string },
): Promise<void> {
  if (meta.score !== undefined) {
    await adb.run('UPDATE exam_questions SET score = ? WHERE exam_id = ? AND question_id = ?', [
      meta.score,
      examId,
      questionId,
    ]);
  }
  if (meta.section !== undefined) {
    await adb.run('UPDATE exam_questions SET section = ? WHERE exam_id = ? AND question_id = ?', [
      meta.section,
      examId,
      questionId,
    ]);
  }
}

/** 改某题的分值 / 大题分组 */
export async function setQuestionMeta(
  adb: AsyncDb,
  examId: number,
  questionId: number,
  meta: { score?: number; section?: string },
): Promise<void> {
  await writeQuestionMeta(adb, examId, questionId, meta);
}

/** 重排卷内顺序（传完整 id 顺序） */
export async function reorder(adb: AsyncDb, examId: number, questionIds: number[]): Promise<void> {
  await adb.transaction(async (tx) => {
    for (const [index, qid] of questionIds.entries()) {
      await tx.run('UPDATE exam_questions SET sort = ? WHERE exam_id = ? AND question_id = ?', [index, examId, qid]);
    }
  });
}

/** 用另一道题替换卷内某题（保持位置/分值/大题） */
export async function replaceQuestion(
  adb: AsyncDb,
  examId: number,
  oldQuestionId: number,
  newQuestionId: number,
): Promise<void> {
  // 旧配置在事务外先读（与原实现一致：读到的就是替换前的卷内配置）
  const current = await questionInExam(adb, examId, oldQuestionId);
  await adb.transaction(async (tx) => {
    await tx.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, oldQuestionId]);
    await tx.run(
      `INSERT INTO exam_questions (exam_id, question_id, sort, score, section) VALUES (?,?,?,?,?)
       ON CONFLICT (exam_id, question_id) DO UPDATE SET
         sort = excluded.sort, score = excluded.score, section = excluded.section`,
      [examId, newQuestionId, current?.sort ?? 0, current?.score ?? 0, current?.section ?? ''],
    );
  });
}

/**
 * 批量加题（调用方负责事务边界）：已在卷内的自动跳过，返回实际新增数。
 * 题型不存在或已入卷的行返回 `changes = 0`，不占 sort。
 */
async function insertQuestions(adb: AsyncDb, examId: number, questionIds: number[]): Promise<number> {
  let added = 0;
  const maxRow = await adb.get<{ m: number | string | null }>(
    'SELECT MAX(sort) AS m FROM exam_questions WHERE exam_id = ?',
    [examId],
  );
  const maxSort = maxRow?.m;
  let next = maxSort === null || maxSort === undefined ? 0 : Number(maxSort) + 1;
  for (const qid of questionIds) {
    if (!(await adb.get<{ id: number }>('SELECT id FROM questions WHERE id = ?', [qid]))) continue;
    const info = await adb.run(
      `INSERT INTO exam_questions (exam_id, question_id, sort) VALUES (?,?,?)
       ON CONFLICT (exam_id, question_id) DO NOTHING`,
      [examId, qid, next],
    );
    if (info.changes > 0) {
      added += 1;
      next += 1;
    }
  }
  return added;
}

/** 批量加题；已在卷内的自动跳过，返回实际新增数 */
export async function addQuestions(adb: AsyncDb, examId: number, questionIds: number[]): Promise<number> {
  return adb.transaction((tx) => insertQuestions(tx, examId, questionIds));
}

/** 组卷落库参数：可选清空 + 加题 + 逐题分值/大题 */
export interface CompositionInput {
  /** true = 先清空卷内题目（智能组卷「重新生成」） */
  replaceExisting: boolean;
  questionIds: number[];
  /** 逐题写分值/大题（缺省项不写，与 `setQuestionMeta` 同口径） */
  meta: Map<number, { score?: number; section?: string }>;
}

/**
 * 组卷原子落库：清空 + 批量加题 + 逐题写分值/大题在**同一个事务**里。
 * 任何一步失败（含临时触发器模拟的中途失败）都整批回滚，
 * 不会留下「已清空但只加了一半题」的残卷。
 */
export async function applyComposition(adb: AsyncDb, examId: number, input: CompositionInput): Promise<number> {
  return adb.transaction(async (tx) => {
    if (input.replaceExisting) {
      await tx.run('DELETE FROM exam_questions WHERE exam_id = ?', [examId]);
    }
    const added = await insertQuestions(tx, examId, input.questionIds);
    for (const [questionId, meta] of input.meta) {
      await writeQuestionMeta(tx, examId, questionId, meta);
    }
    return added;
  });
}

export async function removeQuestion(adb: AsyncDb, examId: number, questionId: number): Promise<void> {
  await adb.run('DELETE FROM exam_questions WHERE exam_id = ? AND question_id = ?', [examId, questionId]);
}

/** 把某题型的所有题统一刷成「大题名 + 每题分值」（组卷按题型生成大题用） */
export async function applySection(
  adb: AsyncDb,
  examId: number,
  type: string,
  sectionName: string,
  score: number,
): Promise<number> {
  const res = await adb.run(
    `UPDATE exam_questions SET section = ?, score = ?
     WHERE exam_id = ?
       AND question_id IN (SELECT id FROM questions WHERE type = ?)`,
    [sectionName, score, examId, type],
  );
  return res.changes;
}

/** 清空卷内题目（智能组卷「重新生成」用） */
export async function clearQuestions(adb: AsyncDb, examId: number): Promise<number> {
  const res = await adb.run('DELETE FROM exam_questions WHERE exam_id = ?', [examId]);
  return res.changes;
}

export async function questionIds(adb: AsyncDb, examId: number): Promise<number[]> {
  const rows = await adb.all<{ question_id: number }>('SELECT question_id FROM exam_questions WHERE exam_id = ?', [
    examId,
  ]);
  return rows.map((r) => Number(r.question_id));
}
