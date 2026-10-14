/**
 * 易错题挑题：从真实作答数据里算每题错误率。
 *
 * 数据来源：`attempts.answers`（课后练习）与 `exam_attempts.answers`（考试）都是
 * `[{ qid, answer, correct }]` 的 JSON；`correct` 为 `true/false/null`，
 * **null 是主观题（待自评），不计入错误率**，否则填空题/简答题会被算成"全错"。
 *
 * 性能取舍：这是一次全表 JSON 展开聚合。真机作答量很小（几十条 attempt），
 * 但仍然加 5 分钟缓存 —— 挑题是连续点击的高频操作，不该每次都扫。
 */
import type { Db } from '../client.js';
import { wilsonLowerBound } from '../../domain/errorRate.js';

export interface QuestionErrorStat {
  /** 参与统计的客观题作答次数 */
  attempts: number;
  wrong: number;
  /** 原始错误率 0–1 */
  rate: number;
  /**
   * 排序用分：**威尔逊置信下界**（见 `domain/errorRate.ts`）。
   *
   * 不能直接按 `rate` 排：真机上大量题只有 1–2 次作答，"答 1 次错 1 次"= 100%，
   * 会把没有数据的题顶到第一屏。威尔逊下界把样本量算进去，样本少自动降权。
   * **原始 rate 与 attempts 照常返回**，界面要如实显示"仅 N 次作答"。
   */
  score: number;
}

const CACHE_MS = 5 * 60 * 1000;

export class QuestionStatsRepository {
  private cache: { at: number; value: Map<number, QuestionErrorStat> } | null = null;

  constructor(private readonly db: Db) {}

  /** 每题错误率（全库）；`refresh` 强制重算 */
  errorByQuestion(options?: { refresh?: boolean }): Map<number, QuestionErrorStat> {
    if (!options?.refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;

    const rows = this.db.all<{ qid: number; n: number; wrong: number }>(
      `WITH graded AS (
         SELECT json_extract(je.value, '$.qid') AS qid,
                json_extract(je.value, '$.correct') AS correct
         FROM attempts a, json_each(a.answers) je
         WHERE json_extract(je.value, '$.correct') IN (1, 0)
         UNION ALL
         SELECT json_extract(je.value, '$.qid') AS qid,
                json_extract(je.value, '$.correct') AS correct
         FROM exam_attempts ea, json_each(ea.answers) je
         WHERE json_extract(je.value, '$.correct') IN (1, 0)
       )
       SELECT CAST(qid AS INTEGER) AS qid, COUNT(*) AS n, SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) AS wrong
       FROM graded
       WHERE qid IS NOT NULL
       GROUP BY qid`,
    );

    const value = new Map<number, QuestionErrorStat>();
    for (const row of rows) {
      const attempts = Number(row.n) || 0;
      if (attempts <= 0) continue;
      const wrong = Number(row.wrong) || 0;
      value.set(Number(row.qid), {
        attempts,
        wrong,
        rate: wrong / attempts,
        score: wilsonLowerBound(wrong, attempts),
      });
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** 缓存时间（供界面显示"数据统计于 …"） */
  cachedAt(): number | null {
    return this.cache?.at ?? null;
  }
}
