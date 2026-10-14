/**
 * 「易错题」排序分：威尔逊置信下界（Wilson score lower bound）。
 *
 * 为什么不用原始错误率排序（真机实测的教训）：
 *   真机上大量题只有 1–2 次作答，"答 1 次错 1 次"= 100%，直接排会把噪声顶到第一屏，
 *   老师挑到的其实是**没有数据**的题。拉普拉斯平滑也不够：
 *   `(wrong+1)/(attempts+2)` 下 1 次错 1 次 = 0.667，仍然压过 3 次错 2 次 = 0.6。
 *
 * 威尔逊下界把"样本量"算进去，样本越少、下界越低，等价于自动降权：
 *   1 错 / 1 次  → 0.207
 *   2 错 / 3 次  → 0.274
 *   12 错 / 20 次 → 0.372   ← 证据更足，排前面（这才是老师想看到的"真易错"）
 *   0 错 / 5 次  → 0.000
 *
 * 界面上仍然显示**原始错误率与作答次数**，这里只决定排序。
 */

/** 95% 置信度的 z 值 */
const Z = 1.96;

export function wilsonLowerBound(wrong: number, attempts: number, z = Z): number {
  if (!Number.isFinite(attempts) || attempts <= 0) return 0;
  const n = attempts;
  const p = Math.min(1, Math.max(0, wrong / n));
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (center - margin) / denominator);
}
