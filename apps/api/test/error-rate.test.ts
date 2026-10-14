/**
 * 易错题排序分（威尔逊置信下界）：样本越少越降权。
 */
import { describe, expect, it } from 'vitest';
import { wilsonLowerBound } from '../src/domain/errorRate.js';

describe('威尔逊置信下界', () => {
  it('没有作答数据得 0（不参与排序）', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(3, 0)).toBe(0);
  });

  it('全对得 0（下界不会大于 0）', () => {
    expect(wilsonLowerBound(0, 5)).toBe(0);
  });

  it('小样本被降权：1 错/1 次 < 2 错/3 次 < 12 错/20 次', () => {
    const one = wilsonLowerBound(1, 1);
    const three = wilsonLowerBound(2, 3);
    const twenty = wilsonLowerBound(12, 20);
    expect(one).toBeLessThan(three);
    expect(three).toBeLessThan(twenty);
    // 这正是「不能按原始错误率排」的原因：1/1 的原始错误率是 100%，却排在最后
    expect(one).toBeLessThan(0.25);
    expect(twenty).toBeGreaterThan(0.35);
  });

  it('样本量相同则错得多的排前面', () => {
    expect(wilsonLowerBound(6, 10)).toBeGreaterThan(wilsonLowerBound(4, 10));
    expect(wilsonLowerBound(4, 10)).toBeGreaterThan(wilsonLowerBound(1, 10));
  });

  it('错误率相同则样本多的排前面（证据更足）', () => {
    expect(wilsonLowerBound(10, 20)).toBeGreaterThan(wilsonLowerBound(1, 2));
    expect(wilsonLowerBound(10, 20)).toBeGreaterThan(wilsonLowerBound(5, 10));
  });

  it('结果始终落在 0–1 之间', () => {
    for (const [w, n] of [
      [0, 1],
      [1, 1],
      [1, 2],
      [99, 100],
      [1, 100],
    ] as const) {
      const v = wilsonLowerBound(w, n);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
