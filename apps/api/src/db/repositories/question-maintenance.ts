/**
 * 题目维护：预计算列回填、指纹回填与题库题量兜底修复（历史数据一次性）。
 *
 * 从 questionRepository 抽出。这些方法都按 id 分页、事务批量写，跑第二遍结果相同（幂等）；
 * 旧数据里常见几十万行，批量写在 NAS 上容易撞 busy，统一走 `withBusyRetry`。
 * （全量重算指纹会改变查重结果，放在 question-dedupe.ts，与去重逻辑同域。）
 */
import { hasMediaOnlyAnalysis, parseOptions, questionFingerprint } from '../../domain/question.js';
import type { Db } from '../client.js';
import { QUESTION_MEDIA_REF } from './question-types.js';
import { withBusyRetry } from './question-write.js';

/**
 * 回填 `analysis_media_only`（迁移 0020 的预计算列，老数据跑一次）。
 *
 * 判定要「去掉图片标记后没剩下字」，SQL 做不了字符串剥离，所以按 id 分页把候选行取出来在
 * JS 里判，再批量更新。候选用 `LIKE '%![%'`（**任何** markdown 图片，含外部图床 ——
 * 真机有 11 道题解析指向阿里云 OSS），不能只按本站题图收窄，否则会漏。
 * 幂等：跑第二遍结果相同（重复跑只是白扫一遍含图的行）。
 */
export function backfillAnalysisMediaOnly(db: Db, batchSize = 2000): number {
  let lastId = 0;
  let updated = 0;
  for (;;) {
    const rows = db.all<{ id: number; analysis: string }>(
      `SELECT id, analysis FROM questions
       WHERE id > ? AND analysis LIKE '%![%' ORDER BY id LIMIT ?`,
      [lastId, batchSize],
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]?.id ?? lastId;
    const only = rows.filter((r) => hasMediaOnlyAnalysis(r.analysis)).map((r) => r.id);
    if (only.length > 0) {
      withBusyRetry(() =>
        db.transaction(() => {
          for (const id of only) db.run('UPDATE questions SET analysis_media_only = 1 WHERE id = ?', [id]);
        }),
      );
      updated += only.length;
    }
  }
  return updated;
}

/** 回填 `has_image`（老数据一次性；导入器对新数据会直接写这一列） */
export function backfillHasImage(db: Db, batchSize = 5000): number {
  let updated = 0;
  const imageLike = `%${QUESTION_MEDIA_REF}%`;
  for (;;) {
    const rows = db.all<{ id: number }>(
      `SELECT id FROM questions
       WHERE has_image = 0 AND (stem LIKE ? OR options LIKE ? OR analysis LIKE ?)
       LIMIT ?`,
      [imageLike, imageLike, imageLike, batchSize],
    );
    if (rows.length === 0) break;
    withBusyRetry(() =>
      db.transaction(() => {
        for (const r of rows) db.run('UPDATE questions SET has_image = 1 WHERE id = ?', [r.id]);
      }),
    );
    updated += rows.length;
  }
  return updated;
}

/** 缺少内容指纹的题目数（体检/回填用） */
export function countMissingContentHash(db: Db): number {
  return (
    db.get<{ c: number }>("SELECT COUNT(*) AS c FROM questions WHERE content_hash IS NULL OR content_hash = ''")?.c ?? 0
  );
}

/**
 * 回填空的内容指纹。
 *
 * 为什么要：指纹是查重与「同题不同答案」体检的判据，导入器会写入，
 * 但**管理端手工新增/编辑**的题目历史上不会写（已在服务层修掉），老数据用这个补一次。
 */
export function backfillContentHash(db: Db, batchSize = 2000): number {
  let updated = 0;
  for (;;) {
    const rows = db.all<{ id: number; stem: string; options: string }>(
      `SELECT id, stem, options FROM questions
       WHERE content_hash IS NULL OR content_hash = '' LIMIT ?`,
      [batchSize],
    );
    if (rows.length === 0) break;
    withBusyRetry(() =>
      db.transaction(() => {
        for (const r of rows) {
          db.run('UPDATE questions SET content_hash = ? WHERE id = ?', [
            questionFingerprint(r.stem, parseOptions(r.options)),
            r.id,
          ]);
        }
      }),
    );
    updated += rows.length;
  }
  return updated;
}

/**
 * 按题库重新统计题量（兜底修复）。
 * 正常写路径都会维护 `banks.question_count`，这里用于：
 *   · 历史数据/运维脚本绕过写路径直接改题目后；
 *   · 体检发现对不上时。
 * 返回被修正的题库数（只更新真正不一致的）。
 */
export function fixBankQuestionCounts(db: Db): number {
  return db.run(
    `UPDATE banks
     SET question_count = (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id)
     WHERE question_count <> (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id)`,
  ).changes;
}
