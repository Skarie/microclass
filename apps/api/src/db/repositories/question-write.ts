/**
 * 题目写入：新增/编辑/元数据回填、删题、批量导入与批量删除、题库题量修复。
 *
 * 从 questionRepository 抽出。关键约束保持不变：
 * - `banks.question_count` 是预计算列，写路径必须同步加减（`bumpBankCount`）；
 * - `update` 里 `analysisMediaOnly === undefined` 表示「不动这一列」，不能无条件覆盖；
 * - 批量删除/插入各自一个事务，语义与拆分前一致。
 *
 * P0 阶段 2（B3b）：全部写方法改走 `AsyncDb`；批量写用 `AsyncDb.transaction(async tx)`，
 * **回调内的语句必须走 `tx`**（sqlite BEGIN IMMEDIATE / PG 单连接 BEGIN + ROLLBACK）。
 */
import type { AsyncDb } from '../async.js';
import { maxOf } from '../sql.js';
import type { QuestionInput } from './question-types.js';

/** 异步 sleep（批量写脚本退避重试用） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SQLITE_BUSY / database is locked 判定 */
function isBusyError(e: unknown): boolean {
  const err = e as { errcode?: number; code?: string; message?: string };
  return err?.errcode === 5 || /locked|busy/i.test(String(err?.message ?? ''));
}

/**
 * 写事务重试：真机上（NAS 机械盘）一次批次提交可能超过 `busy_timeout`，
 * 与运行中的服务撞车就会抛 `database is locked`（导入器同样处理过这个问题）。
 * 难度落库、指纹回填等批量写共用这一份策略（PG 下不会有 SQLITE_BUSY，异常会直接抛出）。
 */
export async function withBusyRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isBusyError(e)) throw e;
      await sleep(Math.min(15000, 500 * 2 ** i));
    }
  }
  throw lastError;
}

/** 题库题量增减（bankId 为空或非法时不动） */
async function bumpBankCount(db: AsyncDb, bankId: number | null | undefined, delta: number): Promise<void> {
  if (typeof bankId !== 'number' || !Number.isInteger(bankId) || delta === 0) return;
  // 方言 #20：SQLite 的 `MAX(0, x)` 是标量函数，PG 的 MAX 只有聚合形式（`max(integer, bigint) does not exist`）
  const floorZero = maxOf('0', 'question_count + ?', db.driver);
  await db.run(`UPDATE banks SET question_count = ${floorZero} WHERE id = ?`, [delta, bankId]);
}

export async function createQuestion(db: AsyncDb, input: QuestionInput): Promise<number> {
  // `INSERT ... RETURNING id`：两库同一句，不再依赖 lastInsertRowid
  const row = await db.get<{ id: number }>(
    `INSERT INTO questions
       (bank_id, lesson_id, type, stem, image_path, options, answer, analysis, sort, difficulty,
        subject, stage, book, chapter, section, point, source_path, source_no, source_id, content_hash, has_image,
        analysis_media_only)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
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
  );
  if (!row) throw new Error('创建题目后未返回 id');
  await bumpBankCount(db, input.bankId, 1);
  return row.id;
}

export async function updateQuestion(db: AsyncDb, id: number, input: QuestionInput): Promise<void> {
  const before = await db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
  // `analysisMediaOnly` 用 `undefined` 表示「不动这一列」：不是所有调用方都关心这个预计算列
  // （例如「同题不同答案」核对只改答案），无条件写会把标记清成 0。
  const setMediaOnly = input.analysisMediaOnly !== undefined;
  await db.run(
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
    await bumpBankCount(db, before.bank_id, -1);
    await bumpBankCount(db, input.bankId, 1);
  }
}

/** 只更新标准化元数据（回填历史数据用，不动题面与答案） */
export async function setQuestionMetadata(
  db: AsyncDb,
  id: number,
  meta: Pick<QuestionInput, 'subject' | 'stage' | 'book' | 'chapter' | 'point' | 'sourcePath' | 'contentHash'>,
): Promise<void> {
  await db.run(
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

export async function setQuestionImage(db: AsyncDb, id: number, imagePath: string): Promise<void> {
  await db.run('UPDATE questions SET image_path = ? WHERE id = ?', [imagePath, id]);
}

export async function deleteQuestion(db: AsyncDb, id: number): Promise<void> {
  const before = await db.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
  await db.run('DELETE FROM questions WHERE id = ?', [id]);
  if (before) await bumpBankCount(db, before.bank_id, -1);
}

/**
 * 批量插入（CSV 导入），返回写入条数。
 * 一个事务：中途任何一条失败，整批回滚（见 `test/question-write-transaction.test.ts`）。
 */
export async function insertManyQuestions(db: AsyncDb, inputs: QuestionInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  let inserted = 0;
  await db.transaction(async (tx) => {
    for (const input of inputs) {
      await createQuestion(tx, input);
      inserted += 1;
    }
  });
  return inserted;
}

/** 批量改章节/小节：只改属于该题库的题，返回实际更新条数（跨库 id 自动跳过） */
export async function setQuestionsSections(
  db: AsyncDb,
  bankId: number,
  ids: number[],
  patch: { chapter?: string; section?: string },
): Promise<number> {
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
  const res = await db.run(`UPDATE questions SET ${sets.join(', ')} WHERE bank_id = ? AND id IN (${placeholders})`, [
    ...params,
    bankId,
    ...ids,
  ]);
  return res.changes;
}

/** 批量删除（去重/清理用，一个事务）；同步维护题库题量 */
export async function deleteManyQuestions(db: AsyncDb, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  let removed = 0;
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const before = await tx.get<{ bank_id: number }>('SELECT bank_id FROM questions WHERE id = ?', [id]);
      await tx.run('DELETE FROM questions WHERE id = ?', [id]);
      if (before) await bumpBankCount(tx, before.bank_id, -1);
      removed += 1;
    }
  });
  return removed;
}
