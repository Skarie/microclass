/**
 * 题目难度模型的数据访问：判定特征、分数读取、作答统计、批量落库与人工标注。
 *
 * 从 questionRepository 抽出（迁移 0016）。分页与阈值语义保持不变：
 * - `difficultyFeatures` 按 id 游标翻页，只读判定需要的列；
 * - 落库走 `withBusyRetry` 包裹的事务，`manual` / `calibrated` 的来源由服务层决定；
 * - `answerStats` 从随堂练习与考试的 answers JSON 汇总，简答题（correct=null）不计入。
 */
import type { Db } from '../client.js';
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
export function difficultyFeatures(db: Db, options: DifficultyFeatureOptions = {}): DifficultyFeatureRow[] {
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
export function allDifficultyScores(db: Db): number[] {
  return db
    .all<{ difficulty_score: number }>('SELECT difficulty_score FROM questions WHERE difficulty_score >= 0')
    .map((r) => r.difficulty_score);
}

export function difficultyScoreOf(db: Db, id: number): DifficultyScoreRow | undefined {
  return db.get<DifficultyScoreRow>('SELECT id, difficulty_score FROM questions WHERE id = ?', [id]);
}

/**
 * 每题的真实作答统计（难度校准的数据源）。
 * 数据来自随堂练习（`attempts`）与考试（`exam_attempts`）的 answers JSON：
 * `[{ qid, answer, correct }]`，`correct` 为 null 表示该题型不自动判分（不计入）。
 */
export function answerStats(db: Db): Map<number, AnswerStat> {
  const out = new Map<number, AnswerStat>();
  for (const table of ['attempts', 'exam_attempts'] as const) {
    let afterId = 0;
    for (;;) {
      const rows = db.all<{ id: number; answers: string }>(
        `SELECT id, answers FROM ${table} WHERE id > ? ORDER BY id LIMIT 1000`,
        [afterId],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        afterId = row.id;
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

/** 批量写难度结果（score + 三档 + 来源 + 校准信息） */
export function setDifficulty(db: Db, items: DifficultyUpdateItem[]): number {
  if (items.length === 0) return 0;
  let updated = 0;
  withBusyRetry(() =>
    db.transaction(() => {
      for (const it of items) {
        db.run(
          `UPDATE questions SET difficulty_score = ?, difficulty = ?, difficulty_source = ?,
             difficulty_n = ?, difficulty_p = ?, difficulty_at = unixepoch() WHERE id = ?`,
          [it.score, it.difficulty, it.source, it.n ?? 0, it.p ?? null, it.id],
        );
        updated += 1;
      }
    }),
  );
  return updated;
}

/** 单题难度（老师手动指定：来源标 manual，之后重算不会覆盖） */
export function setManualDifficulty(db: Db, id: number, difficulty: string, score: number): void {
  db.run(
    `UPDATE questions SET difficulty = ?, difficulty_score = ?, difficulty_source = 'manual',
       difficulty_at = unixepoch() WHERE id = ?`,
    [difficulty, score, id],
  );
}
