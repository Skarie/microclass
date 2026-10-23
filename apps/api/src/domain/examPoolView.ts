/**
 * 题池响应拼装（纯逻辑，可直接单测）。
 *
 * 从 `routes/exams.ts` 抽出：题池每一行都要把「题目元数据 + 错率统计」拼成同一种结构，
 * 易错题模式还要过滤样本不足、按威尔逊下界排序后再分页。这些规则以前写在 handler 里，
 * 现在抽成纯函数，路由只负责查库、传参、把结果套进分页信封。
 */

/** 题池查询行（PickRow 的结构子集，避免领域层依赖仓储实现） */
export interface PoolRow {
  id: number;
  stem: string;
  type: string;
  bank_id: number;
  bank_name: string;
  point: string;
  book: string;
  difficulty?: string;
  difficulty_score: number;
}

/** 每题错率统计（QuestionStatsRepository.errorByQuestion 的 value 结构） */
export interface ErrorStat {
  attempts: number;
  wrong: number;
  /** 原始错误率 0–1 */
  rate: number;
  /** 排序用威尔逊下界 */
  score: number;
}

/** 题池一行（普通模式与易错题模式字段一致，界面无需分支） */
export interface PoolQuestionView {
  id: number;
  stem: string;
  type: string;
  bank_id: number;
  bank_name: string;
  point: string;
  book: string;
  difficulty?: string;
  difficulty_score: number;
  attempts: number;
  wrong: number;
  error_rate: number;
  error_score: number;
}

/** 单行拼装：错率保留三位小数（与拆分前一致），没有作答数据时按 0 返回 */
export function poolQuestionView(row: PoolRow, stat?: ErrorStat): PoolQuestionView {
  return {
    id: row.id,
    stem: row.stem,
    type: row.type,
    bank_id: row.bank_id,
    bank_name: row.bank_name,
    point: row.point,
    book: row.book,
    difficulty: row.difficulty,
    difficulty_score: row.difficulty_score,
    attempts: stat?.attempts ?? 0,
    wrong: stat?.wrong ?? 0,
    error_rate: stat ? Math.round(stat.rate * 1000) / 1000 : 0,
    error_score: stat?.score ?? 0,
  };
}

/** 普通模式：按查询顺序逐行拼装（错率照常带上，界面可直接显示「错率 50%（2 次）」） */
export function buildPoolQuestions(rows: PoolRow[], stats: Map<number, ErrorStat>): PoolQuestionView[] {
  return rows.map((row) => poolQuestionView(row, stats.get(row.id)));
}

export interface ErrorPoolOptions {
  /** 最小作答次数：低于它的题样本不足，不进易错榜 */
  minAttempts: number;
  page: number;
  pageSize: number;
}

export interface ErrorPoolPage {
  /** 过滤后、分页前的总数 */
  total: number;
  questions: PoolQuestionView[];
}

/**
 * 易错题模式：拼行 → 过滤样本不足 → 按威尔逊下界降序（同分按作答量降序）→ 分页。
 * 排序必须在内存里做：错误率来自作答聚合，不在 questions 表里。
 */
export function buildErrorPoolPage(
  rows: PoolRow[],
  stats: Map<number, ErrorStat>,
  options: ErrorPoolOptions,
): ErrorPoolPage {
  const enriched = buildPoolQuestions(rows, stats)
    .filter((row) => row.attempts >= options.minAttempts)
    .sort((a, b) => b.error_score - a.error_score || b.attempts - a.attempts);
  const start = (options.page - 1) * options.pageSize;
  return { total: enriched.length, questions: enriched.slice(start, start + options.pageSize) };
}
