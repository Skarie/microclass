/**
 * 冲突题台账的**只读** SQL（P0 阶段 2：全部走 `AsyncDb`，sqlite / pg 双栈）。
 *
 * 为什么单独成文件：`questionConflictRepository` 已在文件行数守卫的技术债基线里
 * （只能减不能增），而异步化会给每条语句加 `await`；把取数拆出来后，仓储只留
 * 扫描/写台账的逻辑，两个文件都在 200 行左右。
 *
 * 方言与类型口径：
 *   - int8（方言 #17）：`COUNT(*)`、`MIN(id)`、`group_size` 等在 PG 里经 node-postgres
 *     默认返回字符串，**在仓储边界统一 `Number()`**，不让字符串漏进服务层/JSON；
 *   - 本文件不写 `unixepoch()`（时间戳写入在仓储层用 `nowSeconds`）。
 */
import type { AsyncDb } from '../async.js';

export type ConflictStatus = 'pending' | 'resolved' | 'ignored';

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

export interface ConflictQuestionRow {
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
}

export interface ConflictAnswerRow {
  answer: string;
  n: number;
  first_id: number;
}

export interface ConflictCounts {
  pending: number;
  resolved: number;
  ignored: number;
  total: number;
}

export interface ConflictPage {
  items: ConflictRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 与 `items` 对应的答案分布（列表页一次查完，避免 N+1） */
  answers: Map<string, ConflictAnswerRow[]>;
}

/** 单行台账 → 数字化的 `ConflictRow`（int8 收敛，方言 #17） */
function toRow(raw: ConflictRow): ConflictRow {
  return {
    ...raw,
    group_size: Number(raw.group_size ?? 0),
    answer_count: Number(raw.answer_count ?? 0),
    reviewer_id: raw.reviewer_id === null || raw.reviewer_id === undefined ? null : Number(raw.reviewer_id),
    updated_at: Number(raw.updated_at ?? 0),
  };
}

/** 台账分页（默认只看待核对，按组内题量倒序）+ 本页各组的答案分布 */
export async function listConflicts(
  db: AsyncDb,
  options: { status?: ConflictStatus | 'all'; page?: number; pageSize?: number },
): Promise<ConflictPage> {
  const status = options.status ?? 'pending';
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const page = Math.max(1, options.page ?? 1);
  const where = status === 'all' ? '' : ' WHERE status = ?';
  const params = status === 'all' ? [] : [status];
  const totalRow = await db.get<{ c: number | string }>(`SELECT COUNT(*) AS c FROM question_conflicts${where}`, params);
  const rows = await db.all<ConflictRow>(
    `SELECT * FROM question_conflicts${where} ORDER BY group_size DESC, content_hash LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const items = rows.map(toRow);
  return {
    items,
    total: Number(totalRow?.c ?? 0),
    page,
    pageSize,
    answers: await answersForHashes(
      db,
      items.map((item) => item.content_hash),
    ),
  };
}

/** 某个冲突组里的题目（含题库名与来源，便于判断该信哪个答案） */
export async function conflictQuestions(db: AsyncDb, hash: string): Promise<ConflictQuestionRow[]> {
  const rows = await db.all<ConflictQuestionRow>(
    `SELECT q.id, q.answer, q.type, q.difficulty, q.stem, q.bank_id, COALESCE(b.name, '') AS bank_name,
            COALESCE(b.kind, '') AS bank_kind, q.source_no, q.source_path
       FROM questions q LEFT JOIN banks b ON b.id = q.bank_id
      WHERE q.content_hash = ? ORDER BY q.id`,
    [hash],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), bank_id: Number(row.bank_id) }));
}

/** 组内各答案的出现次数（列表里直接显示「答案 A ×2、答案 B ×1」） */
export async function conflictAnswers(db: AsyncDb, hash: string): Promise<ConflictAnswerRow[]> {
  const rows = await db.all<{ answer: string; n: number | string; first_id: number | string }>(
    `SELECT answer, COUNT(*) AS n, MIN(id) AS first_id FROM questions
      WHERE content_hash = ? GROUP BY answer ORDER BY n DESC, answer`,
    [hash],
  );
  return rows.map((row) => ({ answer: row.answer, n: Number(row.n ?? 0), first_id: Number(row.first_id ?? 0) }));
}

/** 批量取多组的答案分布（列表页一次查完，避免 N+1） */
export async function answersForHashes(db: AsyncDb, hashes: string[]): Promise<Map<string, ConflictAnswerRow[]>> {
  const out = new Map<string, ConflictAnswerRow[]>();
  if (hashes.length === 0) return out;
  const placeholders = hashes.map(() => '?').join(',');
  const rows = await db.all<{
    content_hash: string;
    answer: string;
    n: number | string;
    first_id: number | string;
  }>(
    `SELECT content_hash, answer, COUNT(*) AS n, MIN(id) AS first_id FROM questions
      WHERE content_hash IN (${placeholders}) GROUP BY content_hash, answer ORDER BY content_hash, n DESC, answer`,
    hashes,
  );
  for (const row of rows) {
    const list = out.get(row.content_hash) ?? [];
    list.push({ answer: row.answer, n: Number(row.n ?? 0), first_id: Number(row.first_id ?? 0) });
    out.set(row.content_hash, list);
  }
  return out;
}

/** 单条台账 */
export async function findConflict(db: AsyncDb, hash: string): Promise<ConflictRow | undefined> {
  const row = await db.get<ConflictRow>('SELECT * FROM question_conflicts WHERE content_hash = ?', [hash]);
  return row ? toRow(row) : undefined;
}

/** 按状态计数（列表页徽标与「该不该重扫」判断都用它） */
export async function conflictCounts(db: AsyncDb): Promise<ConflictCounts> {
  const rows = await db.all<{ status: string; c: number | string }>(
    'SELECT status, COUNT(*) AS c FROM question_conflicts GROUP BY status',
  );
  const get = (status: string): number => Number(rows.find((row) => row.status === status)?.c ?? 0);
  return {
    pending: get('pending'),
    resolved: get('resolved'),
    ignored: get('ignored'),
    total: rows.reduce((sum, row) => sum + Number(row.c ?? 0), 0),
  };
}
