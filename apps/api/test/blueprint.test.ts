/**
 * 双向细目表（组卷输入）的纯逻辑：校验、归一化、汇总、挑题顺序。
 */
import { describe, expect, it } from 'vitest';
import {
  blueprintSummary,
  normalizeBlueprintCells,
  orderCellsForPick,
  MAX_TOTAL_COUNT,
} from '../src/domain/blueprint.js';

describe('细目表校验与归一化', () => {
  it('忽略 0 与负数格，保留正数格', () => {
    const cells = normalizeBlueprintCells([
      { point: '分数的意义', type: 'single', level: 'easy', count: 3 },
      { point: '分数的意义', type: 'single', level: 'medium', count: 0 },
      { point: '分数的意义', type: 'single', level: 'hard', count: -2 },
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ type: 'single', level: 'easy', count: 3 });
  });

  it('同一格重复出现时合并数量（前端可能来自多次点击）', () => {
    const cells = normalizeBlueprintCells([
      { point: '方程', type: 'fill', level: 'medium', count: 2 },
      { point: '方程', type: 'fill', level: 'medium', count: 3 },
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.count).toBe(5);
  });

  it('知识点留空表示不限知识点，与具体知识点不合并', () => {
    const cells = normalizeBlueprintCells([
      { point: '', type: 'judge', level: 'easy', count: 1 },
      { point: '有理数', type: 'judge', level: 'easy', count: 1 },
    ]);
    expect(cells).toHaveLength(2);
  });

  it('非法题型/难度直接报错（不静默丢弃）', () => {
    expect(() => normalizeBlueprintCells([{ point: '', type: 'essay', level: 'easy', count: 1 }])).toThrow(
      /不支持的题型/,
    );
    expect(() => normalizeBlueprintCells([{ point: '', type: 'single', level: 'insane', count: 1 }])).toThrow(
      /不支持的难度/,
    );
  });

  it('空表与超量报错（避免"以为配满了"）', () => {
    expect(() => normalizeBlueprintCells([])).toThrow(/还没有任何数量/);
    expect(() => normalizeBlueprintCells([{ point: '', type: 'single', level: 'easy', count: 101 }])).toThrow(
      /单格最多/,
    );
    const big = Array.from({ length: 4 }, (_, i) => ({
      point: `p${i}`,
      type: 'single',
      level: 'easy',
      count: 100,
    }));
    expect(() => normalizeBlueprintCells(big)).toThrow(new RegExp(`最多 ${MAX_TOTAL_COUNT}`));
  });

  it('非数组输入报错', () => {
    expect(() => normalizeBlueprintCells({ cells: [] })).toThrow(/应为数组/);
  });
});

describe('细目表汇总', () => {
  it('给出总量、题型/难度分布与知识点清单', () => {
    const cells = normalizeBlueprintCells([
      { point: '分数', type: 'single', level: 'easy', count: 3 },
      { point: '分数', type: 'fill', level: 'hard', count: 2 },
      { point: '方程', type: 'single', level: 'easy', count: 1 },
    ]);
    const summary = blueprintSummary(cells);
    expect(summary.total).toBe(6);
    expect(summary.byType).toEqual([
      { type: 'single', count: 4 },
      { type: 'fill', count: 2 },
    ]);
    expect(summary.byLevel).toEqual([
      { level: 'easy', count: 4 },
      { level: 'hard', count: 2 },
    ]);
    expect(summary.points).toEqual(['分数', '方程']);
  });
});

describe('挑题顺序', () => {
  it('数量大的格先抽，减少冷门知识点被抢空的概率', () => {
    const cells = normalizeBlueprintCells([
      { point: 'A', type: 'single', level: 'easy', count: 1 },
      { point: 'B', type: 'single', level: 'easy', count: 5 },
      { point: 'C', type: 'single', level: 'easy', count: 3 },
    ]);
    expect(orderCellsForPick(cells).map((c) => c.point)).toEqual(['B', 'C', 'A']);
  });
});
