/**
 * 题库体检缓存的键/新鲜度，以及去重计划（拆自 bankService 的纯逻辑）。
 * 去重计划的「可删数量」必须只统计答案一致的重复组（由仓储先过滤），样例最多 10 组。
 */
import { describe, expect, it } from 'vitest';
import { HEALTH_CACHE_MS, healthCacheKey, isHealthCacheFresh, planDedupe } from '../src/services/bankHealthService.js';

describe('题库体检缓存', () => {
  it('全库与单库、不同分页上限使用不同的缓存键', () => {
    expect(healthCacheKey(undefined, 20)).toBe('all|20');
    expect(healthCacheKey(7, 50)).toBe('7|50');
    expect(healthCacheKey(7, 20)).not.toBe(healthCacheKey(7, 50));
  });

  it('缓存有效期严格小于 5 分钟', () => {
    const at = 1_000;
    expect(isHealthCacheFresh(at, at + HEALTH_CACHE_MS - 1)).toBe(true);
    expect(isHealthCacheFresh(at, at + HEALTH_CACHE_MS)).toBe(false);
  });
});

describe('题库去重计划', () => {
  it('统计可删数量并给出保留题样例', () => {
    const plan = planDedupe(
      [
        { hash: 'a', keepId: 1, removeIds: [2, 3] },
        { hash: 'b', keepId: 4, removeIds: [5] },
      ],
      (keepId) => (keepId === 1 ? '第一题' : '第二题'),
    );

    expect(plan.groups).toBe(2);
    expect(plan.removable).toBe(3);
    expect(plan.samples).toEqual([
      { stem: '第一题', count: 3 },
      { stem: '第二题', count: 2 },
    ]);
  });

  it('样例最多 10 组，题干截断到 120 字', () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({ hash: `h${i}`, keepId: i + 1, removeIds: [100 + i] }));
    const plan = planDedupe(groups, () => 'x'.repeat(200));

    expect(plan.samples).toHaveLength(10);
    expect(plan.samples[0]?.stem).toHaveLength(120);
  });

  it('没有重复时计划为空', () => {
    expect(planDedupe([], () => '')).toEqual({ groups: 0, removable: 0, samples: [] });
  });
});
