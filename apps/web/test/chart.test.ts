/**
 * 图表几何纯函数测试：弧线边界（占满整圈/零值）、坐标轴取整、单点数据不崩。
 */
import { describe, expect, it } from 'vitest';
import { areaPath, axisTicks, donutArcs, linePath, linePoints, niceMax, sparkline } from '../src/utils/chart.js';

describe('环形图弧段', () => {
  const base = { cx: 60, cy: 60, outer: 56, inner: 36 };

  it('按数值分配占比', () => {
    const arcs = donutArcs(
      [
        { label: 'A', value: 5 },
        { label: 'B', value: 3 },
        { label: 'C', value: 2 },
      ],
      base,
    );
    expect(arcs.map((a) => a.ratio)).toEqual([0.5, 0.3, 0.2]);
    expect(arcs.every((a) => a.path.startsWith('M '))).toBe(true);
  });

  it('零值段占 0 且不画路径（不能出现 NaN 路径）', () => {
    const arcs = donutArcs(
      [
        { label: 'A', value: 3 },
        { label: 'B', value: 0 },
      ],
      base,
    );
    expect(arcs[1]?.ratio).toBe(0);
    expect(arcs[1]?.path).toBe('');
  });

  it('全是 0 时返回空数组（避免除零）', () => {
    expect(donutArcs([{ label: 'A', value: 0 }], base)).toEqual([]);
  });

  it('单段占满整圈也能画出（起止点重合的退化情况）', () => {
    const arcs = donutArcs([{ label: 'A', value: 10 }], base);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    expect(arc?.ratio).toBe(1);
    // 整圈退化成两个半圆：每个半圆是"外弧 + 内弧"的闭合子路径 → 两个 Z
    expect((arc?.path ?? '').split('Z').length - 1).toBe(2);
    expect(arc?.path ?? '').not.toContain('NaN');
  });

  it('负值被当作 0 处理，不产生反向弧', () => {
    const arcs = donutArcs(
      [
        { label: 'A', value: 4 },
        { label: 'B', value: -2 },
      ],
      base,
    );
    expect(arcs[0]?.ratio).toBe(1);
    expect(arcs[1]?.ratio).toBe(0);
  });
});

describe('坐标轴刻度', () => {
  it('把最大值抬到 1/2/5×10^n', () => {
    expect(niceMax(347)).toBe(500);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(0)).toBe(1); // 全 0 也不能返回 0
    expect(niceMax(-5)).toBe(1);
  });

  it('刻度等分且含 0 与上界', () => {
    expect(axisTicks(347, 4)).toEqual([0, 125, 250, 375, 500]);
    expect(axisTicks(0, 2)).toEqual([0, 0.5, 1]);
  });
});

describe('折线坐标', () => {
  const size = { width: 200, height: 100, padding: { top: 10, right: 10, bottom: 10, left: 10 } };

  it('数值越大 y 越小（屏幕坐标反转）', () => {
    const points = linePoints(
      [
        { label: 'a', value: 0 },
        { label: 'b', value: 10 },
      ],
      { ...size, max: 10 },
    );
    expect(points[0]?.y).toBe(90);
    expect(points[1]?.y).toBe(10);
    expect(points[0]?.x).toBe(10);
    expect(points[1]?.x).toBe(190);
  });

  it('单点居中，不出现 NaN', () => {
    const points = linePoints([{ label: 'only', value: 5 }], { ...size, max: 10 });
    expect(points).toHaveLength(1);
    expect(points[0]?.x).toBe(100);
    expect(Number.isNaN(points[0]?.y)).toBe(false);
  });

  it('空数组返回空，path 也是空字符串', () => {
    expect(linePoints([], size)).toEqual([]);
    expect(linePath([])).toBe('');
    expect(areaPath([], { height: 100, baselineY: 90 })).toBe('');
  });

  it('面积 path 闭合到底边', () => {
    const points = linePoints(
      [
        { label: 'a', value: 1 },
        { label: 'b', value: 2 },
      ],
      { ...size, max: 2 },
    );
    const area = areaPath(points, { height: 100, baselineY: 90 });
    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain('L 190 90');
  });
});

describe('迷你火花线', () => {
  it('归一化到给定宽高，单点居中', () => {
    const points = sparkline([0, 5, 10], 100, 20);
    expect(points[0]?.y).toBe(20);
    expect(points[2]?.y).toBe(0);
    expect(sparkline([3], 100, 20)[0]?.x).toBe(50);
  });

  it('全等值时不会除以 0', () => {
    const points = sparkline([2, 2, 2], 100, 20);
    expect(points.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});
