/**
 * 冲突题（同题不同答案）台账仓储。
 *
 * 为什么单独一张表：冲突组要靠 `GROUP BY content_hash HAVING COUNT(DISTINCT answer) > 1`
 * 扫全库算出来（36.6 万题、590MB 的库在 NAS 机械盘上一次要几秒），
 * 而核对是「人一条条看」的过程，需要**落库 + 分页 + 记录复核结果**，
 * 因此把扫描结果物化到 `question_conflicts`，只在需要时重新扫描（sync）。
 *
 * P0 阶段 2（收尾批次）：整个仓储改走 `AsyncDb`，PG 模式下不再落回 SQLite；
 * 4 处 `unixepoch()` 换成 `nowSeconds(driver)`（方言 #19）；只读 SQL 拆到
 * `question-conflict-queries.ts`（本文件在行数守卫的基线里，只能减不能增）。
 */
import type { AsyncDb } from '../async.js';
import { nowSeconds } from '../sql.js';
import { stemSummary } from '../../domain/stemSummary.js';
import {
  answersForHashes,
  conflictAnswers,
  conflictCounts,
  conflictQuestions,
  findConflict,
  listConflicts,
  type ConflictAnswerRow,
  type ConflictCounts,
  type ConflictPage,
  type ConflictQuestionRow,
} from './question-conflict-queries.js';

export type {
  ConflictAnswerRow,
  ConflictCounts,
  ConflictPage,
  ConflictQuestionRow,
} from './question-conflict-queries.js';
export type { ConflictRow, ConflictStatus } from './question-conflict-queries.js';

/** 台账最长保鲜时间：超过就提示重扫一次（导入新题库后能发现新冲突组） */
export const CONFLICT_SYNC_TTL_MS = 5 * 60 * 1000;

export interface SyncResult {
  scanned: number;
  inserted: number;
  removed: number;
  pending: number;
  /** 分段耗时（毫秒）：冷缓存时 scan 可能上千毫秒到几分钟 */
  ms: { scan: number; cleanup: number; write: number; stems: number; meta: number; total: number };
}

export class QuestionConflictRepository {
  constructor(private readonly db: AsyncDb) {}

  /**
   * 重新扫描全库，把「同题不同答案」的组写进台账：
   * - 新发现的组以 pending 入库；
   * - 已经 resolved / ignored 的保留状态（不覆盖人的判断）；
   * - 已经不复存在的组清理掉，但 `resolved` 保留作为「已核对」历史；
   * - 已核对过的组又被改回冲突（有人改了答案）→ 打回 pending 重新提示。
   *
   * 真机实测：**冷缓存**（容器刚重启 / 刚 drop_caches）时全库分组要几分钟
   * （NAS 机械盘 + 600MB 库），热缓存约 2 秒。所以这条路径只由**用户明确的动作**触发，
   * 列表页不得隐式调用（见 `QuestionConflictService.list`）；返回的 `ms` 是分段耗时，便于排查。
   */
  async sync(): Promise<SyncResult> {
    const ms = { scan: 0, cleanup: 0, write: 0, stems: 0, meta: 0, total: 0 };
    const t0 = Date.now();
    let removed = 0;
    let inserted = 0;

    // 1) 扫出冲突组：一次按 `(content_hash, answer)` 覆盖索引的分组扫描（不回表），
    //    `MIN(answer) <> MAX(answer)` 与 `COUNT(DISTINCT answer) > 1` 等价但省掉每组的临时去重表。
    //    题干样例不在这里取（题干是大字段，回表会把冷缓存扫描拖慢到几十秒），
    //    只对真正冲突的几百组单独查一次（见第 3 步）。
    let t = Date.now();
    const rows = await this.db.all<{ content_hash: string; n: number | string; a: number | string }>(
      `SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS a
       FROM questions WHERE content_hash <> ''
       GROUP BY content_hash HAVING COUNT(*) > 1 AND MIN(answer) <> MAX(answer)`,
    );
    ms.scan = Date.now() - t;
    const keeping = new Set(rows.map((r) => r.content_hash));

    await this.db.transaction(async (tx) => {
      // 2) 清理不再冲突的记录（`resolved` 是核对历史，保留）
      t = Date.now();
      const stale = await tx.all<{ content_hash: string }>(
        "SELECT content_hash FROM question_conflicts WHERE status <> 'resolved'",
      );
      for (const row of stale) {
        if (keeping.has(row.content_hash)) continue;
        await tx.run('DELETE FROM question_conflicts WHERE content_hash = ?', [row.content_hash]);
        removed += 1;
      }
      ms.cleanup = Date.now() - t;

      // 3) 写入 / 更新台账（题干样例只对新组查一次，避免全库回表）
      t = Date.now();
      const existing = new Set(
        (await tx.all<{ content_hash: string }>('SELECT content_hash FROM question_conflicts')).map(
          (r) => r.content_hash,
        ),
      );
      for (const r of rows) {
        if (existing.has(r.content_hash)) {
          // 已核对过的组又冲突了 → 打回待核对（题目被改回去了，需要重新看）；
          // 同时刷新题干摘要：旧版用 `slice(0,200)` 可能切出残缺 markdown（真机 bug），
          // 不靠"看起来坏了"去猜（题干里先出现 `)` 就会漏判），直接按新规则重算。
          await tx.run(
            `UPDATE question_conflicts
             SET group_size = ?, answer_count = ?, sample_stem = ?,
                 status = CASE WHEN status = 'resolved' THEN 'pending' ELSE status END
             WHERE content_hash = ?`,
            [r.n, r.a, await this.sampleStem(tx, r.content_hash), r.content_hash],
          );
          continue;
        }
        await tx.run(
          `INSERT INTO question_conflicts (content_hash, status, sample_stem, group_size, answer_count)
           VALUES (?, 'pending', ?, ?, ?)`,
          [r.content_hash, await this.sampleStem(tx, r.content_hash), r.n, r.a],
        );
        inserted += 1;
      }
      ms.write = Date.now() - t;

      // 4) 兜底：历史遗留的残缺摘要（旧版截断在 200 字符，或切断了图片 markdown）一并修正。
      //    已核对/已忽略的行不会走上面的分支，但它们在列表里同样会显示题干。
      t = Date.now();
      const legacy = await tx.all<{ content_hash: string }>(
        `SELECT content_hash FROM question_conflicts
         WHERE (sample_stem LIKE '%![%' AND sample_stem NOT LIKE '%)%') OR length(sample_stem) = 200`,
      );
      for (const row of legacy) {
        await tx.run('UPDATE question_conflicts SET sample_stem = ? WHERE content_hash = ?', [
          await this.sampleStem(tx, row.content_hash),
          row.content_hash,
        ]);
      }
      ms.stems = Date.now() - t;
    });

    t = Date.now();
    const counts = await this.counts();
    await this.markSynced(counts);
    ms.meta = Date.now() - t;
    ms.total = Date.now() - t0;
    return { scanned: counts.total, inserted, removed, pending: counts.pending, ms };
  }

  /** 取某组的一道题的题干做样例（大字段，只对新入库的组查） */
  private async sampleStem(db: AsyncDb, hash: string): Promise<string> {
    const row = await db.get<{ stem: string }>('SELECT stem FROM questions WHERE content_hash = ? LIMIT 1', [hash]);
    return stemSummary(String(row?.stem ?? ''), 200);
  }

  /** 记下本次扫描时的题量水位与时间（下次靠它判断台账是否过期） */
  private async markSynced(counts?: { pending?: number; total?: number }): Promise<void> {
    const now = nowSeconds(this.db.driver);
    const maxIdRow = await this.db.get<{ m: number | string }>('SELECT COALESCE(MAX(id), 0) AS m FROM questions');
    const c = counts ?? (await this.counts());
    await this.db.run(
      `INSERT INTO question_conflict_meta (id, last_sync_at, questions_max_id, conflict_total, pending_total)
       VALUES (1, ${now}, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_sync_at = ${now},
         questions_max_id = excluded.questions_max_id,
         conflict_total = excluded.conflict_total,
         pending_total = excluded.pending_total`,
      [Number(maxIdRow?.m ?? 0), c.total ?? 0, c.pending ?? 0],
    );
  }

  /**
   * 台账是否该重扫。判断依据（都很快，不扫全库）：
   * - 从未扫过；
   * - 台账为空（可能是上次扫描后题目被清空/还没建）；
   * - 题目 id 水位上涨（导入/新增了题目，可能带来新的冲突组）；
   * - 距上次扫描超过 TTL。
   */
  async staleness(): Promise<{ stale: boolean; reason: 'never' | 'empty' | 'grew' | 'ttl' | 'fresh'; ageMs: number }> {
    const meta = await this.db.get<{ last_sync_at: number | string; questions_max_id: number | string }>(
      'SELECT last_sync_at, questions_max_id FROM question_conflict_meta WHERE id = 1',
    );
    const lastSyncAt = Number(meta?.last_sync_at ?? 0);
    const ageMs = lastSyncAt > 0 ? Date.now() - lastSyncAt * 1000 : Number.POSITIVE_INFINITY;
    if (!meta || lastSyncAt === 0) return { stale: true, reason: 'never', ageMs };
    if ((await this.counts()).total === 0) return { stale: true, reason: 'empty', ageMs };
    const maxIdRow = await this.db.get<{ m: number | string }>('SELECT COALESCE(MAX(id), 0) AS m FROM questions');
    if (Number(maxIdRow?.m ?? 0) !== Number(meta.questions_max_id)) return { stale: true, reason: 'grew', ageMs };
    if (ageMs > CONFLICT_SYNC_TTL_MS) return { stale: true, reason: 'ttl', ageMs };
    return { stale: false, reason: 'fresh', ageMs };
  }

  /** 台账分页（含本页各组的答案分布，一次查完） */
  async list(options: {
    status?: 'pending' | 'resolved' | 'ignored' | 'all';
    page?: number;
    pageSize?: number;
  }): Promise<ConflictPage> {
    return listConflicts(this.db, options);
  }

  /** 某个冲突组里的题目（含题库名与来源） */
  async questions(hash: string): Promise<ConflictQuestionRow[]> {
    return conflictQuestions(this.db, hash);
  }

  /** 组内各答案的出现次数 */
  async answers(hash: string): Promise<ConflictAnswerRow[]> {
    return conflictAnswers(this.db, hash);
  }

  /** 批量取多组的答案分布（翻页批量处理用） */
  async answersFor(hashes: string[]): Promise<Map<string, ConflictAnswerRow[]>> {
    return answersForHashes(this.db, hashes);
  }

  async find(hash: string) {
    return findConflict(this.db, hash);
  }

  /**
   * 写核对结论。`meta` 用于「核对后该组已不再是冲突（sync 会删掉它）」时补齐组信息，
   * 这样历史记录里还能看到当时那道题的题干和题量。
   */
  async upsertStatus(
    hash: string,
    status: 'pending' | 'resolved' | 'ignored',
    chosenAnswer: string,
    reviewer: { id: number | null; name: string },
    meta?: { groupSize?: number; answerCount?: number; sampleStem?: string },
  ): Promise<void> {
    const now = nowSeconds(this.db.driver);
    await this.db.run(
      `INSERT INTO question_conflicts (content_hash, status, chosen_answer, reviewer_id, reviewer_name, group_size, answer_count, sample_stem, updated_at)
       VALUES (?,?,?,?,?,?,?,?, ${now})
       ON CONFLICT(content_hash) DO UPDATE SET
         status = excluded.status,
         chosen_answer = excluded.chosen_answer,
         reviewer_id = excluded.reviewer_id,
         reviewer_name = excluded.reviewer_name,
         group_size = CASE WHEN excluded.group_size > 0 THEN excluded.group_size ELSE question_conflicts.group_size END,
         answer_count = CASE WHEN excluded.answer_count > 0 THEN excluded.answer_count ELSE question_conflicts.answer_count END,
         sample_stem = CASE WHEN excluded.sample_stem <> '' THEN excluded.sample_stem ELSE question_conflicts.sample_stem END,
         updated_at = ${now}`,
      [
        hash,
        status,
        chosenAnswer,
        reviewer.id,
        reviewer.name,
        meta?.groupSize ?? 0,
        meta?.answerCount ?? 0,
        meta?.sampleStem ?? '',
      ],
    );
  }

  async counts(): Promise<ConflictCounts> {
    return conflictCounts(this.db);
  }
}
