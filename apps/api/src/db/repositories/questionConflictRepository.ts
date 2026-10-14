/**
 * 冲突题（同题不同答案）台账仓储。
 *
 * 为什么单独一张表：冲突组要靠 `GROUP BY content_hash HAVING COUNT(DISTINCT answer) > 1`
 * 扫全库算出来（36.6 万题、590MB 的库在 NAS 机械盘上一次要几秒），
 * 而核对是「人一条条看」的过程，需要**落库 + 分页 + 记录复核结果**，
 * 因此把扫描结果物化到 `question_conflicts`，只在需要时重新扫描（sync）。
 */
import type { Db } from '../client.js';
import { stemSummary } from '../../domain/stemSummary.js';

export type ConflictStatus = 'pending' | 'resolved' | 'ignored';

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

export interface ConflictRow {
  content_hash: string;
  status: ConflictStatus;
  chosen_answer: string;
  sample_stem: string;
  group_size: number;
  answer_count: number;
  reviewer_id: number | null;
  reviewer_name: string;
  updated_at: number;
}

export class QuestionConflictRepository {
  constructor(private readonly db: Db) {}

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
  sync(): SyncResult {
    const ms = { scan: 0, cleanup: 0, write: 0, stems: 0, meta: 0, total: 0 };
    const t0 = Date.now();
    let removed = 0;
    let inserted = 0;

    // 1) 扫出冲突组：一次按 `(content_hash, answer)` 覆盖索引的分组扫描（不回表），
    //    `MIN(answer) <> MAX(answer)` 与 `COUNT(DISTINCT answer) > 1` 等价但省掉每组的临时去重表。
    //    题干样例不在这里取（题干是大字段，回表会把冷缓存扫描拖慢到几十秒），
    //    只对真正冲突的几百组单独查一次（见第 3 步）。
    let t = Date.now();
    const rows = this.db.all<{
      content_hash: string;
      n: number;
      a: number;
    }>(
      `SELECT content_hash, COUNT(*) AS n, COUNT(DISTINCT answer) AS a
       FROM questions WHERE content_hash <> ''
       GROUP BY content_hash HAVING COUNT(*) > 1 AND MIN(answer) <> MAX(answer)`,
    );
    ms.scan = Date.now() - t;
    const keeping = new Set(rows.map((r) => r.content_hash));

    this.db.transaction(() => {
      // 2) 清理不再冲突的记录（`resolved` 是核对历史，保留）
      t = Date.now();
      const stale = this.db.all<{ content_hash: string }>(
        "SELECT content_hash FROM question_conflicts WHERE status <> 'resolved'",
      );
      for (const row of stale) {
        if (keeping.has(row.content_hash)) continue;
        this.db.run('DELETE FROM question_conflicts WHERE content_hash = ?', [row.content_hash]);
        removed += 1;
      }
      ms.cleanup = Date.now() - t;

      // 3) 写入 / 更新台账（题干样例只对新组查一次，避免全库回表）
      t = Date.now();
      const existing = new Set(
        this.db.all<{ content_hash: string }>('SELECT content_hash FROM question_conflicts').map((r) => r.content_hash),
      );
      for (const r of rows) {
        if (existing.has(r.content_hash)) {
          // 已核对过的组又冲突了 → 打回待核对（题目被改回去了，需要重新看）；
          // 同时刷新题干摘要：旧版用 `slice(0,200)` 可能切出残缺 markdown（真机 bug），
          // 不靠"看起来坏了"去猜（题干里先出现 `)` 就会漏判），直接按新规则重算。
          this.db.run(
            `UPDATE question_conflicts
             SET group_size = ?, answer_count = ?, sample_stem = ?,
                 status = CASE WHEN status = 'resolved' THEN 'pending' ELSE status END
             WHERE content_hash = ?`,
            [r.n, r.a, this.sampleStem(r.content_hash), r.content_hash],
          );
          continue;
        }
        this.db.run(
          `INSERT INTO question_conflicts (content_hash, status, sample_stem, group_size, answer_count)
           VALUES (?, 'pending', ?, ?, ?)`,
          [r.content_hash, this.sampleStem(r.content_hash), r.n, r.a],
        );
        inserted += 1;
      }
      ms.write = Date.now() - t;

      // 4) 兜底：历史遗留的残缺摘要（旧版截断在 200 字符，或切断了图片 markdown）一并修正。
      //    已核对/已忽略的行不会走上面的分支，但它们在列表里同样会显示题干。
      t = Date.now();
      const legacy = this.db.all<{ content_hash: string }>(
        `SELECT content_hash FROM question_conflicts
         WHERE (sample_stem LIKE '%![%' AND sample_stem NOT LIKE '%)%') OR length(sample_stem) = 200`,
      );
      for (const row of legacy) {
        this.db.run('UPDATE question_conflicts SET sample_stem = ? WHERE content_hash = ?', [
          this.sampleStem(row.content_hash),
          row.content_hash,
        ]);
      }
      ms.stems = Date.now() - t;
    });

    t = Date.now();
    const counts = this.counts();
    this.markSynced(counts);
    ms.meta = Date.now() - t;
    ms.total = Date.now() - t0;
    return { scanned: counts.total, inserted, removed, pending: counts.pending, ms };
  }

  /** 取某组的一道题的题干做样例（大字段，只对新入库的组查） */
  private sampleStem(hash: string): string {
    const row = this.db.get<{ stem: string }>('SELECT stem FROM questions WHERE content_hash = ? LIMIT 1', [hash]);
    return stemSummary(String(row?.stem ?? ''), 200);
  }

  /** 记下本次扫描时的题量水位与时间（下次靠它判断台账是否过期） */
  private markSynced(counts?: { pending?: number; total?: number }): void {
    const maxId = this.db.get<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM questions')?.m ?? 0;
    const c = counts ?? this.counts();
    this.db.run(
      `INSERT INTO question_conflict_meta (id, last_sync_at, questions_max_id, conflict_total, pending_total)
       VALUES (1, unixepoch(), ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_sync_at = unixepoch(),
         questions_max_id = excluded.questions_max_id,
         conflict_total = excluded.conflict_total,
         pending_total = excluded.pending_total`,
      [maxId, c.total ?? 0, c.pending ?? 0],
    );
  }

  /**
   * 台账是否该重扫。判断依据（都很快，不扫全库）：
   * - 从未扫过；
   * - 台账为空（可能是上次扫描后题目被清空/还没建）；
   * - 题目 id 水位上涨（导入/新增了题目，可能带来新的冲突组）；
   * - 距上次扫描超过 TTL。
   */
  staleness(): { stale: boolean; reason: 'never' | 'empty' | 'grew' | 'ttl' | 'fresh'; ageMs: number } {
    const meta = this.db.get<{ last_sync_at: number; questions_max_id: number }>(
      'SELECT last_sync_at, questions_max_id FROM question_conflict_meta WHERE id = 1',
    );
    const ageMs = meta && meta.last_sync_at > 0 ? Date.now() - meta.last_sync_at * 1000 : Number.POSITIVE_INFINITY;
    if (!meta || meta.last_sync_at === 0) return { stale: true, reason: 'never', ageMs };
    if (this.counts().total === 0) return { stale: true, reason: 'empty', ageMs };
    const maxId = this.db.get<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM questions')?.m ?? 0;
    if (maxId !== meta.questions_max_id) return { stale: true, reason: 'grew', ageMs };
    if (ageMs > CONFLICT_SYNC_TTL_MS) return { stale: true, reason: 'ttl', ageMs };
    return { stale: false, reason: 'fresh', ageMs };
  }

  list(options: { status?: ConflictStatus | 'all'; page?: number; pageSize?: number }): {
    items: ConflictRow[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const status = options.status ?? 'pending';
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const page = Math.max(1, options.page ?? 1);
    const where = status === 'all' ? '' : ' WHERE status = ?';
    const params = status === 'all' ? [] : [status];
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM question_conflicts${where}`, params)?.c ?? 0;
    const items = this.db.all<ConflictRow>(
      `SELECT * FROM question_conflicts${where} ORDER BY group_size DESC, content_hash LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return { items, total, page, pageSize };
  }

  /** 某个冲突组里的题目（含题库名与来源，便于判断该信哪个答案） */
  questions(hash: string): {
    id: number;
    answer: string;
    type: string;
    difficulty: string;
    stem: string;
    bank_id: number;
    bank_name: string;
    bank_kind: string;
    source_no: string;
    source_path: string;
  }[] {
    return this.db.all(
      `SELECT q.id, q.answer, q.type, q.difficulty, q.stem, q.bank_id, COALESCE(b.name, '') AS bank_name,
              COALESCE(b.kind, '') AS bank_kind, q.source_no, q.source_path
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id
       WHERE q.content_hash = ? ORDER BY q.id`,
      [hash],
    );
  }

  /** 组内各答案的出现次数（列表里直接显示「答案 A ×2、答案 B ×1」） */
  answers(hash: string): { answer: string; n: number; first_id: number }[] {
    return this.db.all(
      `SELECT answer, COUNT(*) AS n, MIN(id) AS first_id FROM questions
       WHERE content_hash = ? GROUP BY answer ORDER BY n DESC, answer`,
      [hash],
    );
  }

  /** 批量取多组的答案分布（列表页一次查完，避免 N+1） */
  answersFor(hashes: string[]): Map<string, { answer: string; n: number; first_id: number }[]> {
    const out = new Map<string, { answer: string; n: number; first_id: number }[]>();
    if (hashes.length === 0) return out;
    const placeholders = hashes.map(() => '?').join(',');
    const rows = this.db.all<{ content_hash: string; answer: string; n: number; first_id: number }>(
      `SELECT content_hash, answer, COUNT(*) AS n, MIN(id) AS first_id FROM questions
       WHERE content_hash IN (${placeholders}) GROUP BY content_hash, answer ORDER BY content_hash, n DESC, answer`,
      hashes,
    );
    for (const r of rows) {
      const list = out.get(r.content_hash) ?? [];
      list.push({ answer: r.answer, n: r.n, first_id: r.first_id });
      out.set(r.content_hash, list);
    }
    return out;
  }

  find(hash: string): ConflictRow | undefined {
    return this.db.get<ConflictRow>('SELECT * FROM question_conflicts WHERE content_hash = ?', [hash]);
  }

  /**
   * 写核对结论。`meta` 用于「核对后该组已不再是冲突（sync 会删掉它）」时补齐组信息，
   * 这样历史记录里还能看到当时那道题的题干和题量。
   */
  upsertStatus(
    hash: string,
    status: ConflictStatus,
    chosenAnswer: string,
    reviewer: { id: number | null; name: string },
    meta?: { groupSize?: number; answerCount?: number; sampleStem?: string },
  ): void {
    this.db.run(
      `INSERT INTO question_conflicts (content_hash, status, chosen_answer, reviewer_id, reviewer_name, group_size, answer_count, sample_stem, updated_at)
       VALUES (?,?,?,?,?,?,?,?, unixepoch())
       ON CONFLICT(content_hash) DO UPDATE SET
         status = excluded.status,
         chosen_answer = excluded.chosen_answer,
         reviewer_id = excluded.reviewer_id,
         reviewer_name = excluded.reviewer_name,
         group_size = CASE WHEN excluded.group_size > 0 THEN excluded.group_size ELSE question_conflicts.group_size END,
         answer_count = CASE WHEN excluded.answer_count > 0 THEN excluded.answer_count ELSE question_conflicts.answer_count END,
         sample_stem = CASE WHEN excluded.sample_stem <> '' THEN excluded.sample_stem ELSE question_conflicts.sample_stem END,
         updated_at = unixepoch()`,
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

  counts(): { pending: number; resolved: number; ignored: number; total: number } {
    const rows = this.db.all<{ status: string; c: number }>(
      'SELECT status, COUNT(*) AS c FROM question_conflicts GROUP BY status',
    );
    const get = (s: string): number => rows.find((r) => r.status === s)?.c ?? 0;
    // 台账为空时按「实时扫描」给个估算：调用方一般会先 sync 一次
    return {
      pending: get('pending'),
      resolved: get('resolved'),
      ignored: get('ignored'),
      total: rows.reduce((s, r) => s + r.c, 0),
    };
  }
}
