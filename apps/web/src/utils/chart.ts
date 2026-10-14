/**
 * 图表几何与刻度（纯函数，单独可测）。
 *
 * 为什么不用第三方图表库：
 *   1. 本项目是自托管轻量平台，多一个 ~100KB 的图表库不划算，而需要的图形就四种
 *      （环形 / 条形 / 折线面积 / 迷你线）；
 *   2. 图表库默认自带硬编码颜色与内联样式，会绕过我们的设计令牌与
 *      `design-guard`（禁止硬编码色值）约束；
 *   3. 自己算几何能保证**明暗主题、无障碍名、悬浮提示**都按我们的规范来。
 *
 * 这里只放纯计算，不碰 DOM，便于单测（弧线边界、除零、单点数据这些最容易出错）。
 */

export interface ArcSegment {
  label: string;
  value: number;
}

export interface ArcResult {
  label: string;
  value: number;
  /** 占比 0–1 */
  ratio: number;
  /** SVG path 的 d 属性 */
  path: string;
  /** 该段起始角度（度，用于放标签） */
  startAngle: number;
  endAngle: number;
}

const polar = (cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } => {
  // -90° 让第一段从 12 点方向开始
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
};

/** 环形图弧段：把数值切成扇区（含 gap 间隙），全部返回 path */
export function donutArcs(
  segments: ArcSegment[],
  options: { cx: number; cy: number; outer: number; inner: number; gapDeg?: number },
): ArcResult[] {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return [];
  const gap = Math.max(0, options.gapDeg ?? 1.5);
  let cursor = 0;
  const out: ArcResult[] = [];
  for (const seg of segments) {
    const value = Math.max(0, seg.value);
    if (value === 0) {
      out.push({ label: seg.label, value, ratio: 0, path: '', startAngle: cursor, endAngle: cursor });
      continue;
    }
    const sweep = (value / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    // 单段占满整圈时画不出弧（起止点重合），退化成两个半圆
    if (sweep >= 359.999) {
      const mid = start + 180;
      out.push({
        label: seg.label,
        value,
        ratio: 1,
        path: `${ringArc(options, start, mid)} ${ringArc(options, mid, end)}`,
        startAngle: start,
        endAngle: end,
      });
      continue;
    }
    const a0 = start + gap / 2;
    const a1 = Math.max(a0, end - gap / 2);
    out.push({
      label: seg.label,
      value,
      ratio: value / total,
      path: ringArc(options, a0, a1),
      startAngle: start,
      endAngle: end,
    });
  }
  return out;
}

function ringArc(
  options: { cx: number; cy: number; outer: number; inner: number },
  startAngle: number,
  endAngle: number,
): string {
  const { cx, cy, outer, inner } = options;
  const large = endAngle - startAngle > 180 ? 1 : 0;
  const o0 = polar(cx, cy, outer, startAngle);
  const o1 = polar(cx, cy, outer, endAngle);
  const i1 = polar(cx, cy, inner, endAngle);
  const i0 = polar(cx, cy, inner, startAngle);
  return [
    `M ${round(o0.x)} ${round(o0.y)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${round(o1.x)} ${round(o1.y)}`,
    `L ${round(i1.x)} ${round(i1.y)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${round(i0.x)} ${round(i0.y)}`,
    'Z',
  ].join(' ');
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * 「好看的」坐标轴上界：把最大值抬到 1/2/5×10^n，避免刻度出现 347 这种数。
 * 全 0 时返回 1，保证不会除以 0。
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const norm = value / base;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * base;
}

/** 等分刻度值（含 0 与上界），count 为分段数 */
export function axisTicks(max: number, count = 4): number[] {
  const top = niceMax(max);
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(Math.round(((top / count) * i + Number.EPSILON) * 100) / 100);
  return out;
}

export interface LinePoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

/** 折线坐标：把数值序列映射到画布（y 轴反转），单点/全 0 都不炸 */
export function linePoints(
  values: { label: string; value: number }[],
  options: {
    width: number;
    height: number;
    max?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  },
): LinePoint[] {
  const pad = options.padding ?? { top: 8, right: 8, bottom: 8, left: 8 };
  const innerW = Math.max(1, options.width - pad.left - pad.right);
  const innerH = Math.max(1, options.height - pad.top - pad.bottom);
  const max = options.max && options.max > 0 ? options.max : niceMax(Math.max(...values.map((v) => v.value), 0));
  const n = values.length;
  return values.map((v, i) => {
    const x = pad.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const ratio = Math.min(1, Math.max(0, v.value / max));
    const y = pad.top + innerH * (1 - ratio);
    return { x: round(x), y: round(y), value: v.value, label: v.label };
  });
}

/** 折线 path（M...L...） */
export function linePath(points: LinePoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** 面积 path（折线封闭到底边） */
export function areaPath(points: LinePoint[], options: { height: number; baselineY: number }): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L ${last.x} ${options.baselineY} L ${first.x} ${options.baselineY} Z`;
}

/** 迷你火花线：归一化到给定宽高，用于 KPI 卡 */
export function sparkline(values: number[], width: number, height: number): LinePoint[] {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;
  return values.map((value, i) => ({
    x: round(n <= 1 ? width / 2 : (width * i) / (n - 1)),
    y: round(height - ((value - min) / span) * height),
    value,
    label: String(i),
  }));
}
