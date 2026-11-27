/**
 * 作答校准的纯计算（无 IO）：把「先验分 + 真实正确率」按 Beta 收缩融合。
 *
 * 从 `DifficultyService.calibrate` 抽出（该文件受行数守卫约束）。这里只负责
 * 「一块题」的内存计算，取数与落库由服务层按块批量做——所以同一个函数既能
 * 被批处理调用，也能在测试里逐题调用做对照。
 *
 * 口径与迁移前完全一致：先验分 < 0（没算过）按 50 处理；题已不存在就跳过。
 */
import { bucketFromScore, calibrateScore, type DifficultyCuts } from './difficulty.js';

/** 每题作答统计（与仓储 `AnswerStat` 同构；domain 不反向依赖 db 层类型） */
export interface CalibrationStat {
  id: number;
  total: number;
  correct: number;
}

/** 一条待落库的校准结果（`source` 固定 calibrated，之后重算先验不会覆盖） */
export interface CalibrationItem {
  id: number;
  score: number;
  difficulty: string;
  source: 'calibrated';
  n: number;
  p: number;
}

/** 返回给接口的样例（前 10 条，便于界面核对先验分与校准后的差距） */
export interface CalibrationSample {
  id: number;
  prior: number;
  next: number;
  n: number;
  p: number;
}

/** 没算过先验分（`difficulty_score < 0`）时的先验分 */
export const UNCALIBRATED_PRIOR = 50;

export interface CalibrationPlan {
  items: CalibrationItem[];
  samples: CalibrationSample[];
}

/**
 * 计算一块题的校准结果。
 *
 * @param stats    本块候选（已按 `total >= minSamples` 过滤）
 * @param priors   本块先验分（`id → difficulty_score`）；缺失表示题已被删除
 * @param cuts     三档阈值
 * @param options  `k`：先验相当于多少道题的证据量；`sampleLimit`：本块还能补几条样例
 */
export function planCalibration(
  stats: readonly CalibrationStat[],
  priors: ReadonlyMap<number, number>,
  cuts: DifficultyCuts,
  options: { k: number; sampleLimit: number },
): CalibrationPlan {
  const items: CalibrationItem[] = [];
  const samples: CalibrationSample[] = [];
  for (const stat of stats) {
    const stored = priors.get(stat.id);
    if (stored === undefined) continue;
    const prior = stored >= 0 ? stored : UNCALIBRATED_PRIOR;
    const blended = calibrateScore(prior, stat, { k: options.k });
    items.push({
      id: stat.id,
      score: blended.score,
      difficulty: bucketFromScore(blended.score, cuts),
      source: 'calibrated',
      n: stat.total,
      p: blended.p,
    });
    if (samples.length < options.sampleLimit) {
      samples.push({ id: stat.id, prior, next: blended.score, n: stat.total, p: blended.p });
    }
  }
  return { items, samples };
}
