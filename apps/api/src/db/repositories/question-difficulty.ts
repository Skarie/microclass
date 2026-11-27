/**
 * 题目难度模型的数据访问：判定特征、分数读取、作答统计、批量落库与人工标注。
 *
 * 从 questionRepository 抽出（迁移 0016）。分页与阈值语义保持不变：
 * - `difficultyFeatures` 按 id 游标翻页，只读判定需要的列；
 * - 校准要的「按 id 批量取先验分」单列一个方法，避免逐题查询（PG 下每次都是一个往返）；
 * - 落库走 `withBusyRetry` 包裹的事务，`manual` / `calibrated` 的来源由服务层决定；
 * - `answerStats` 从随堂练习与考试的 answers JSON 汇总，简答题（correct=null）不计入。
 *
 * P0 阶段 2（questions 读批次）：读方法改走 `AsyncDb` + `async`；
 * 顺带把 `difficulty_at = unixepoch()` 换成 `nowSeconds(driver)`（方言 #19 漏网点）。
 */
import type { AsyncDb } from '../async.js';
import { nowSeconds } from '../sql.js';
import type {
  AnswerStat,
  DifficultyFeatureOptions,
  DifficultyFeatureRow,
  DifficultyScoreRow,
  DifficultyUpdateItem,
} from './question-types.js';
import { withBusyRetry } from './question-write.js';

/**
 * 取一批题的难度判定特征（分页）。
 * 只选判定需要的列，避免把 analysis 这类大字段读进来放大 I/O。
 */
export async function difficultyFeatures(
  db: AsyncDb,
  options: DifficultyFeatureOptions = {},
): Promise<DifficultyFeatureRow[]> {
  const clauses: string[] = ['q.id > ?'];
  const params: unknown[] = [options.afterId ?? 0];
  if (options.bankId !== undefined) {
    clauses.push('q.bank_id = ?');
    params.push(options.bankId);
  }
  // 只重算「模型算出来的」：人工标注(manual)与已校准(calibrated)默认不动
  if (options.onlyAuto) clauses.push("(q.difficulty_source IS NULL OR q.difficulty_source IN ('', 'auto'))");
  if (options.onlyUnscored) clauses.push('(q.difficulty_score IS NULL OR q.difficulty_score < 0)');
  return db.all<DifficultyFeatureRow>(
    `SELECT q.id, q.bank_id, q.type, q.stem, q.options, q.answer, q.has_image,
            q.subject, q.stage, q.book, q.chapter, q.point, q.difficulty, q.difficulty_source,
            COALESCE(b.kind, '') AS bank_kind, COALESCE(b.name, '') AS bank_name
     FROM questions q LEFT JOIN banks b ON b.id = q.bank_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY q.id LIMIT ?`,
    [...params, Math.min(5000, Math.max(1, options.limit ?? 2000))],
  );
}

/** 全库难度分（走 idx_questions_difficulty_score，纯索引扫描） */
export async function allDifficultyScores(db: AsyncDb): Promise<number[]> {
  const rows = await db.all<{ difficulty_score: number }>(
    'SELECT difficulty_score FROM questions WHERE difficulty_score >= 0',
  );
  return rows.map((r) => Number(r.difficulty_score));
}

export async function difficultyScoreOf(db: AsyncDb, id: number): Promise<DifficultyScoreRow | undefined> {
  return db.get<DifficultyScoreRow>('SELECT id, difficulty_score FROM questions WHERE id = ?', [id]);
}

/** 批量取先验分时一条 `IN (...)` 带多少个 id（SQLite 变量上限 32766，PG 65535，留足余量） */
const IDS_CHUNK = 500;

/**
 * 批量读一批题的先验分（`id → difficulty_score`）。
 *
 * 校准的候选动辄几万题，逐题 `difficultyScoreOf` 在 PG 上就是几万次往返；
 * 这里按 500 个 id 一条 `IN (...)` 取回，块大小同时受两种驱动的变量上限约束。
 * 统一 `Number()`：PG 的 int8 走驱动后是字符串，不做转换会把分数带进字符串运算。
 * 题已被删除时不会出现在结果里，调用方按「缺失 = 跳过」处理（与原逐题查询一致）。
 */
export async function difficultyScoresByIds(db: AsyncDb, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let start = 0; start < ids.length; start += IDS_CHUNK) {
    const chunk = ids.slice(start, start + IDS_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.all<DifficultyScoreRow>(
      `SELECT id, difficulty_score FROM questions WHERE id IN (${placeholders})`,
      chunk,
    );
    for (const row of rows) out.set(Number(row.id), Number(row.difficulty_score));
  }
  return out;
}

/**
 * 每题的真实作答统计（难度校准的数据源）。
 * 数据来自随堂练习（`attempts`）与考试（`exam_attempts`）的 answers JSON：
 * `[{ qid, answer, correct }]`，`correct` 为 null 表示该题型不自动判分（不计入）。
 */
export async function answerStats(db: AsyncDb): Promise<Map<number, AnswerStat>> {
  const out = new Map<number, AnswerStat>();
  for (const table of ['attempts', 'exam_attempts'] as const) {
    let afterId = 0;
    for (;;) {
      const rows = await db.all<{ id: number; answers: string }>(
        `SELECT id, answers FROM ${table} WHERE id > ? ORDER BY id LIMIT 1000`,
        [afterId],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        afterId = Number(row.id);
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.answers);
        } catch {
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        for (const raw of parsed) {
          const item = raw as { qid?: unknown; correct?: unknown };
          const qid = Number(item.qid);
          if (!Number.isInteger(qid) || qid <= 0) continue;
          if (typeof item.correct !== 'boolean') continue; // 简答题不自动判分，不作为难度证据
          const stat = out.get(qid) ?? { id: qid, total: 0, correct: 0 };
          stat.total += 1;
          if (item.correct) stat.correct += 1;
          out.set(qid, stat);
        }
      }
    }
  }
  return out;
}

/** 落库临时表一次装多少行（每行 6 个参数，500 行 = 3000，远低于 SQLite 32766 / PG 65535 上限） */
const WRITE_CHUNK = 500;

/** 写入批处理用的临时表名（会话级；PG 的临时表天然按连接隔离） */
const WRITE_TABLE = '_microclass_difficulty_batch';

/** 临时表 DDL：两种驱动只有列类型不同，其余同一句 SQL */
function writeTableDdl(driver: AsyncDb['driver']): string {
  const idType = driver === 'pg' ? 'BIGINT' : 'INTEGER';
  const pType = driver === 'pg' ? 'DOUBLE PRECISION' : 'REAL';
  return `CREATE TEMP TABLE IF NOT EXISTS ${WRITE_TABLE} (
    id ${idType} PRIMARY KEY, score INTEGER, diff TEXT, src TEXT, n INTEGER, p ${pType})`;
}

/** 多行 VALUES 的 INSERT 语句按「本块行数」缓存：同一次批量写里语句形状稳定，只编译一次 */
const insertSqlCache = new Map<number, string>();
function insertSql(rows: number): string {
  const hit = insertSqlCache.get(rows);
  if (hit) return hit;
  const sql = `INSERT INTO ${WRITE_TABLE} (id, score, diff, src, n, p)
    VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?)').join(',')}`;
  insertSqlCache.set(rows, sql);
  return sql;
}

/**
 * 把临时表关联回 questions 的那一条 UPDATE。
 *
 * - PG：`UPDATE ... FROM temp`，优化器会 hash join 临时表，39.6 万行也只往返一次；
 * - SQLite：`UPDATE ... FROM` 会**先全表扫目标表**（实测 39.6 万行 7.2s），所以改成
 *   `WHERE id IN (SELECT id FROM temp)` + 相关子查询：按主键定位要改的行（实测 1.8s）。
 *   两者都是**一条**批量 UPDATE，不逐题发语句。
 */
function updateSql(driver: AsyncDb['driver'], now: string): string {
  const tail = `difficulty_at = ${now}`;
  if (driver === 'pg') {
    return `UPDATE questions SET
        difficulty_score = b.score, difficulty = b.diff, difficulty_source = b.src,
        difficulty_n = b.n, difficulty_p = b.p, ${tail}
      FROM ${WRITE_TABLE} b WHERE questions.id = b.id`;
  }
  return `UPDATE questions SET
      difficulty_score = (SELECT score FROM ${WRITE_TABLE} b WHERE b.id = questions.id),
      difficulty = (SELECT diff FROM ${WRITE_TABLE} b WHERE b.id = questions.id),
      difficulty_source = (SELECT src FROM ${WRITE_TABLE} b WHERE b.id = questions.id),
      difficulty_n = (SELECT n FROM ${WRITE_TABLE} b WHERE b.id = questions.id),
      difficulty_p = (SELECT p FROM ${WRITE_TABLE} b WHERE b.id = questions.id),
      ${tail}
    WHERE questions.id IN (SELECT id FROM ${WRITE_TABLE})`;
}

/**
 * 批量写难度结果（score + 三档 + 来源 + 校准信息）。
 *
 * 原实现一次事务里**逐题** UPDATE：39.6 万题就是 39.6 万条语句，PG 下还是 39.6 万次往返。
 * 现在先把这一批写进临时表（多行 VALUES，500 行/条），再用**一条**批量 UPDATE 按主键
 * 关联回 `questions`（方言差异见 `updateSql`），整批仍是一个事务，语义（全成功才提交、
 * 返回更新条数）不变。
 *
 * 为什么不用 `UPDATE ... CASE id WHEN ...`：500 行一条的 CASE 在 SQLite 上编译/执行都是
 * O(行数²)（实测 20 万行要十几秒）；临时表 + 一条 UPDATE 的语句数只跟块数有关，
 * 大库在 PG 上从「几十万次往返」压到「几百条语句」。
 */
export async function setDifficulty(db: AsyncDb, items: DifficultyUpdateItem[]): Promise<number> {
  if (items.length === 0) return 0;
  // 同一题重复出现时后写覆盖前写（与逐题 UPDATE 的顺序语义一致），也避免临时表主键冲突
  const unique = [...new Map(items.map((it) => [it.id, it])).values()];
  const now = nowSeconds(db.driver);
  const ddl = writeTableDdl(db.driver);
  const update = updateSql(db.driver, now);
  await withBusyRetry(() =>
    db.transaction(async (tx) => {
      await tx.run(ddl);
      await tx.run(`DELETE FROM ${WRITE_TABLE}`); // 同一连接上的残留（PG 会话级临时表）
      for (let start = 0; start < unique.length; start += WRITE_CHUNK) {
        const chunk = unique.slice(start, start + WRITE_CHUNK);
        const params: unknown[] = [];
        for (const it of chunk) params.push(it.id, it.score, it.difficulty, it.source, it.n ?? 0, it.p ?? null);
        await tx.run(insertSql(chunk.length), params);
      }
      await tx.run(update);
      await tx.run(`DELETE FROM ${WRITE_TABLE}`);
    }),
  );
  return unique.length;
}

/** 单题难度（老师手动指定：来源标 manual，之后重算不会覆盖） */
export async function setManualDifficulty(db: AsyncDb, id: number, difficulty: string, score: number): Promise<void> {
  await db.run(
    `UPDATE questions SET difficulty = ?, difficulty_score = ?, difficulty_source = 'manual',
       difficulty_at = ${nowSeconds(db.driver)} WHERE id = ?`,
    [difficulty, score, id],
  );
}
