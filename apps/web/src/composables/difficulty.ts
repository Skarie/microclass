/**
 * 难度文案的**单一来源**。
 *
 * 之前 `DifficultyBadge.vue`（星级徽标）和题库管理页（可读文字）各写了一份映射，
 * 结果键名不一致：组件里是 `auto → 模型`，页面里写成 `model → 模型评估`，
 * 悬停提示直接显示了原始值 `auto`。现在两处都从这里取。
 */

/** 五级（有评分时按分数分档） */
export const LEVEL_LABEL: Record<number, string> = {
  0: '未评估',
  1: '很容易',
  2: '容易',
  3: '中等',
  4: '较难',
  5: '很难',
};

/** 三档（只有 easy/medium/hard 时的粗粒度） */
export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '基础',
  medium: '中等',
  hard: '较难',
};

/** 难度来源（沿用星级徽标原有的短文案，避免其它页面文字被拉长） */
export const DIFFICULTY_SOURCE_LABEL: Record<string, string> = {
  auto: '模型',
  calibrated: '校准',
  manual: '人工',
};

/** 分数 → 五级（与后端 `levelFromScore` 同口径） */
export function levelFromScore(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(score) || score < 0) return 0;
  if (score < 25) return 1;
  if (score < 40) return 2;
  if (score < 60) return 3;
  if (score < 78) return 4;
  return 5;
}

/** 三档难度 → 中文 */
export function difficultyLabel(difficulty: string | null | undefined): string {
  return difficulty ? (DIFFICULTY_LABEL[difficulty] ?? '未评估') : '未评估';
}

/** 来源代码 → 中文（未知值原样返回，避免"看不懂的代号"） */
export function difficultySourceLabel(source: string | null | undefined): string {
  if (!source) return '';
  return DIFFICULTY_SOURCE_LABEL[source] ?? source;
}
