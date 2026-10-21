/**
 * 重复题与指纹去重：体检分组/冲突汇总、题库内可安全删除的重复组、全量重算指纹。
 *
 * 从 questionRepository 抽出。分组判定是**纯函数** `groupDuplicateRows`：
 * 同指纹且答案一致才可删（保留 id 最小的一条）；同题不同答案属于数据质量问题，
 * 整组不自动处理，由体检的 `conflictGroups` 报出。
 */
import { parseOptions, questionFingerprint } from '../../domain/question.js';
import type { Db } from '../client.js';
import { clampLimit } from './question-query.js';
import { withBusyRetry } from './question-write.js';

/** 重复题分组明细（体检页展示用） */
export interface DuplicateGroupRow {
  content_hash: string;
  n: number;
  answers: number;
  stem: string;
}

/** 全库/单库重复与答案冲突的三口径汇总 */
export interface DuplicateSummary {
  groups: number;
  questions: number;
  conflicts: number;
}

/** 同一题库内可安全删除的重复组 */
export interface DuplicateIdGroup {
  hash: string;
  keepId: number;
  removeIds: number[];
}

/** 去重扫描的原始行；分组逻辑是纯函数 `groupDuplicateRows` */
export interface DuplicateCandidateRow {
  content_hash: string;
  id: number;
  answer: string;
}

/**
 * 重复题分组（体检明细）：返回 hash、题数、答案种类、示例题干。
 *
 * 注意：示例题干**不参与分组聚合**（原写法 `MIN(stem)` 会让全表回表读题干，
 * 真机冷缓存一次要读完整库、几百秒）。这里先用 `(content_hash, answer)` 覆盖索引算出分组，
 * 再只对要展示的这 `limit` 组各取一条题干。
 */
export function duplicateGroups(db: Db, limit: number, bankId?: number): DuplicateGroupRow[] {
  const scope = bankId === undefined ? '' : ' AND bank_id = ?';
  const params = bankId === undefined ? [] : [bankId];
  const capped = clampLimit(limit, 1, 200);
  return db.all<DuplicateGroupRow>(
    `WITH g AS (
       SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS answers
       FROM questions WHERE content_hash <> ''${scope}
       GROUP BY content_hash HAVING COUNT(*) > 1
       ORDER BY n DESC, content_hash LIMIT ?
     )
     SELECT g.content_hash, g.n, g.answers,
            (SELECT q.stem FROM questions q WHERE q.content_hash = g.content_hash LIMIT 1) AS stem
     FROM g ORDER BY g.n DESC, g.content_hash`,
    [...params, capped],
  );
}

/** 重复题与答案冲突的三口径汇总（体检头部卡片用；与明细共用同一条分组口径） */
export function duplicateSummary(db: Db, bankId?: number): DuplicateSummary {
  const scope = bankId === undefined ? '' : ' AND bank_id = ?';
  const params = bankId === undefined ? [] : [bankId];
  return (
    db.get<DuplicateSummary>(
      `WITH g AS (
         SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS a
         FROM questions WHERE content_hash <> ''${scope}
         GROUP BY content_hash HAVING COUNT(*) > 1
       )
       SELECT COUNT(*) AS groups, COALESCE(SUM(n), 0) AS questions, COALESCE(SUM(a > 1), 0) AS conflicts FROM g`,
      params,
    ) ?? { groups: 0, questions: 0, conflicts: 0 }
  );
}

/**
 * 同一题库内、指纹相同**且答案一致**的重复题：每组保留 id 最小的一条，返回要删除的 id。
 * 答案不一致的组不自动处理（属于「同题不同答案」的数据质量问题，由 `health().conflictGroups` 报出）。
 */
export function groupDuplicateRows(rows: DuplicateCandidateRow[], limit: number): DuplicateIdGroup[] {
  const groups = new Map<string, { keepId: number; answer: string; removeIds: number[]; conflict: boolean }>();
  for (const r of rows) {
    const g = groups.get(r.content_hash);
    if (!g) {
      groups.set(r.content_hash, { keepId: r.id, answer: r.answer, removeIds: [], conflict: false });
      continue;
    }
    if (g.answer === r.answer) g.removeIds.push(r.id);
    else g.conflict = true; // 同题不同答案：不自动删
  }
  return [...groups.entries()]
    .filter(([, g]) => g.removeIds.length > 0 && !g.conflict)
    .slice(0, limit)
    .map(([hash, g]) => ({ hash, keepId: g.keepId, removeIds: g.removeIds }));
}

/** 扫描某题库的 (指纹, id, 答案) 行并折算出可删除的重复组 */
export function duplicateIdsInBank(db: Db, bankId: number, limit = 5000): DuplicateIdGroup[] {
  const rows = db.all<DuplicateCandidateRow>(
    `SELECT content_hash, id, answer FROM questions
     WHERE bank_id = ? AND content_hash <> '' ORDER BY content_hash, id`,
    [bankId],
  );
  return groupDuplicateRows(rows, limit);
}

/**
 * 全量重算内容指纹（指纹算法升级时用一次）。
 *
 * 为什么需要：指纹的归一化口径变了（例如图片从「忽略」改成「按地址参与」），
 * 老数据的 `content_hash` 就与新算法不一致 —— 查重会把不同的看图题当成同一题。
 * 按 id 分页重算，跑第二遍得到同样的结果（幂等），返回实际更新的行数。
 */
export function rehashContentHash(
  db: Db,
  batchSize = 2000,
  onProgress?: (done: number, total: number) => void,
): number {
  const total = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c ?? 0;
  let lastId = 0;
  let updated = 0;
  for (;;) {
    const rows = db.all<{ id: number; stem: string; options: string }>(
      'SELECT id, stem, options FROM questions WHERE id > ? ORDER BY id LIMIT ?',
      [lastId, batchSize],
    );
    if (rows.length === 0) break;
    withBusyRetry(() =>
      db.transaction(() => {
        for (const r of rows) {
          db.run('UPDATE questions SET content_hash = ? WHERE id = ?', [
            questionFingerprint(r.stem, parseOptions(r.options)),
            r.id,
          ]);
          lastId = r.id;
        }
      }),
    );
    updated += rows.length;
    onProgress?.(updated, total);
  }
  return updated;
}
