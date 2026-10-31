/**
 * 题目写入：新增/编辑/元数据回填、删题、批量导入与批量删除、题库题量修复。
 *
 * 从 questionRepository 抽出。关键约束保持不变：
 * - `banks.question_count` 是预计算列，写路径必须同步加减（`bumpBankCount`）；
 * - `update` 里 `analysisMediaOnly === undefined` 表示「不动这一列」，不能无条件覆盖；
 * - 批量删除/插入各自一个事务，语义与拆分前一致。
 */
import type { Db } from '../client.js';
import type { QuestionInput } from './question-types.js';

/** 同步 sleep：批量写脚本在 NAS 慢盘上要退避重试，这里不能用 await */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** SQLITE_BUSY / database is locked 判定 */
function isBusyError(e: unknown): boolean {
  const err = e as { errcode?: number; code?: string; message?: string };
  return err?.errcode === 5 || /locked|busy/i.test(String(err?.message ?? ''));
}

/**
 * 写事务重试：真机上（NAS 机械盘）一次批次提交可能超过 `busy_timeout`，
 * 与运行中的服务撞车就会抛 `database is locked`（导入器同样处理过这个问题）。
 * 难度落库、指纹回填等批量写共用这一份策略。
 */
export function withBusyRetry<T>(fn: () => T, attempts = 6): T {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
      if (!isBusyError(e)) throw e;
      sleepSync(Math.min(15000, 500 * 2 ** i));
    }
  }
  throw lastError;
}

/** 题库题量增减（bankId 为空或非法时不动） */
function bumpBankCount(db: Db, bankId: number | null | undefined, delta: number): void {
  if (typeof bankId !== 'number' || !Number.isInteger(bankId) || delta === 0) return;
  db.run('UPDATE banks SET question_count = MAX(0, question_count + ?) WHERE id = ?', [delta, bankId]);
}

export function createQuestion(db: Db, input: QuestionInput): number {
  const created = db.run(
    `INSERT INTO questions
       (bank_id, lesson_id, type, stem, image_path, options, answer, analysis, sort, difficulty,
        subject, stage, book, chapter, section, point, source_path, source_no, source_id, content_hash, has_image,
        analysis_media_only)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.bankId,
      input.lessonId ?? null,
      input.type,
      input.stem,
      input.imagePath ?? '',
      JSON.stringify(input.options),
      input.answer,
      input.analysis ?? '',
      input.sort ?? 0,
      input.difficulty ?? '',
      input.subject ?? '',
      input.stage ?? '',
      input.book ?? '',
      input.chapter ?? '',
      input.section ?? '',
      input.point ?? '',
      input.sourcePath ?? '',
      input.sourceNo ?? '',
      input.sourceId ?? '',
      input.contentHash ?? '',
      input.hasImage ? 1 : 0,
      input.analysisMediaOnly ? 1 : 0,
    ],
  ).lastInsertRowid;
  bumpBankCount(db, input.bankId, 1);
  return created;
}

export function updateQuestion(db: Db, id: number, input: QuestionInput): void {
  const before = db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
  // `analysisMediaOnly` 用 `undefined` 表示「不动这一列」：不是所有调用方都关心这个预计算列
  // （例如「同题不同答案」核对只改答案），无条件写会把标记清成 0。
  const setMediaOnly = input.analysisMediaOnly !== undefined;
  db.run(
    `UPDATE questions SET
       bank_id = ?, lesson_id = ?, type = ?, stem = ?, image_path = ?, options = ?, answer = ?, analysis = ?,
       sort = ?, difficulty = ?, subject = ?, stage = ?, book = ?, chapter = ?, section = ?, point = ?,
       source_path = ?, source_no = ?, source_id = ?, content_hash = ?, has_image = ?${setMediaOnly ? ', analysis_media_only = ?' : ''}
     WHERE id = ?`,
    [
      input.bankId,
      input.lessonId ?? null,
      input.type,
      input.stem,
      input.imagePath ?? '',
      JSON.stringify(input.options),
      input.answer,
      input.analysis ?? '',
      input.sort ?? 0,
      input.difficulty ?? '',
      input.subject ?? '',
      input.stage ?? '',
      input.book ?? '',
      input.chapter ?? '',
      input.section ?? '',
      input.point ?? '',
      input.sourcePath ?? '',
      input.sourceNo ?? '',
      input.sourceId ?? '',
      input.contentHash ?? '',
      input.hasImage ? 1 : 0,
      ...(setMediaOnly ? [input.analysisMediaOnly ? 1 : 0] : []),
      id,
    ],
  );
  if (before && before.bank_id !== input.bankId) {
    bumpBankCount(db, before.bank_id, -1);
    bumpBankCount(db, input.bankId, 1);
  }
}

/** 只更新标准化元数据（回填历史数据用，不动题面与答案） */
export function setQuestionMetadata(
  db: Db,
  id: number,
  meta: Pick<QuestionInput, 'subject' | 'stage' | 'book' | 'chapter' | 'point' | 'sourcePath' | 'contentHash'>,
): void {
  db.run(
    'UPDATE questions SET subject = ?, stage = ?, book = ?, chapter = ?, point = ?, source_path = ?, content_hash = ? WHERE id = ?',
    [
      meta.subject ?? '',
      meta.stage ?? '',
      meta.book ?? '',
      meta.chapter ?? '',
      meta.point ?? '',
      meta.sourcePath ?? '',
      meta.contentHash ?? '',
      id,
    ],
  );
}

export function setQuestionImage(db: Db, id: number, imagePath: string): void {
  db.run('UPDATE questions SET image_path = ? WHERE id = ?', [imagePath, id]);
}

export function deleteQuestion(db: Db, id: number): void {
  const before = db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
  db.run('DELETE FROM questions WHERE id = ?', [id]);
  if (before) bumpBankCount(db, before.bank_id, -1);
}

/** 批量插入（CSV 导入），返回写入条数 */
export function insertManyQuestions(db: Db, inputs: QuestionInput[]): number {
  if (inputs.length === 0) return 0;
  let inserted = 0;
  db.transaction(() => {
    for (const input of inputs) {
      createQuestion(db, input);
      inserted += 1;
    }
  });
  return inserted;
}

/** 批量改章节/小节：只改属于该题库的题，返回实际更新条数（跨库 id 自动跳过） */
export function setQuestionsSections(
  db: Db,
  bankId: number,
  ids: number[],
  patch: { chapter?: string; section?: string },
): number {
  if (ids.length === 0) return 0;
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.chapter !== undefined) {
    sets.push('chapter = ?');
    params.push(patch.chapter);
  }
  if (patch.section !== undefined) {
    sets.push('section = ?');
    params.push(patch.section);
  }
  if (sets.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return db.run(`UPDATE questions SET ${sets.join(', ')} WHERE bank_id = ? AND id IN (${placeholders})`, [
    ...params,
    bankId,
    ...ids,
  ]).changes;
}

/** 批量删除（去重/清理用，一个事务）；同步维护题库题量 */
export function deleteManyQuestions(db: Db, ids: number[]): number {
  if (ids.length === 0) return 0;
  let removed = 0;
  db.transaction(() => {
    for (const id of ids) {
      const before = db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
      db.run('DELETE FROM questions WHERE id = ?', [id]);
      if (before) bumpBankCount(db, before.bank_id, -1);
      removed += 1;
    }
  });
  return removed;
}
