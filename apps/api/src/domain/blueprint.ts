import { asText } from '../utils/text.js';
/**
 * 双向细目表（组卷的「输入」）。
 *
 * 与已有能力的区别：
 *  - 已有「智能组卷」的输入是 **题型配额 + 全局难度配比**（如：单选 10 道、难易 3:5:2）；
 *  - 细目表的输入是 **逐格的（知识点 × 题型 × 难度）数量**，例如
 *    「分数的意义 / 单选 / 易 3 道」「分数的意义 / 填空 / 中 2 道」……
 *    这才是教研真正拿来做卷子的表：既要题型与难度分布，也要**知识点覆盖**。
 *
 * 本模块只做纯逻辑（校验/归一化/汇总），挑题与落库在 ExamService。
 */

export const BLUEPRINT_TYPES = ['single', 'multiple', 'judge', 'fill', 'short'] as const;
export type BlueprintType = (typeof BLUEPRINT_TYPES)[number];

export const BLUEPRINT_LEVELS = ['easy', 'medium', 'hard'] as const;
export type BlueprintLevel = (typeof BLUEPRINT_LEVELS)[number];

export interface BlueprintCell {
  /** 知识点；空串表示「不限知识点」（用于只想控制题型×难度的场景） */
  point: string;
  type: BlueprintType;
  level: BlueprintLevel;
  count: number;
}

/** 单格上限与总量上限：防止误填 1000 把页面和题池拖垮 */
export const MAX_CELL_COUNT = 100;
export const MAX_TOTAL_COUNT = 300;
export const MAX_CELLS = 200;

const TYPE_SET = new Set<string>(BLUEPRINT_TYPES);
const LEVEL_SET = new Set<string>(BLUEPRINT_LEVELS);

/**
 * 校验并归一化前端传来的细目表。
 * 规则：忽略数量 ≤0 的格；同一格（知识点+题型+难度）重复时**合并数量**；
 * 单格与总量超限时抛错（不做静默截断，避免老师以为已经按表配满）。
 */
export function normalizeBlueprintCells(raw: unknown): BlueprintCell[] {
  if (!Array.isArray(raw)) throw new Error('细目表格式不对：应为数组');
  if (raw.length > MAX_CELLS) throw new Error(`细目表最多 ${MAX_CELLS} 格`);

  const merged = new Map<string, BlueprintCell>();
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const type = asText(row.type);
    const level = asText(row.level);
    if (!TYPE_SET.has(type)) throw new Error(`不支持的题型：${type}`);
    if (!LEVEL_SET.has(level)) throw new Error(`不支持的难度：${level}`);
    const count = Math.floor(Number(row.count ?? 0));
    if (!Number.isFinite(count) || count <= 0) continue;
    if (count > MAX_CELL_COUNT) throw new Error(`单格最多 ${MAX_CELL_COUNT} 题`);
    const point = asText(row.point).trim();
    const key = `${point}|${type}|${level}`;
    const exist = merged.get(key);
    if (exist) exist.count += count;
    else merged.set(key, { point, type: type as BlueprintType, level: level as BlueprintLevel, count });
  }

  const cells = [...merged.values()];
  const total = cells.reduce((sum, c) => sum + c.count, 0);
  if (cells.length === 0) throw new Error('细目表还没有任何数量（每格填 0 等于没填）');
  if (total > MAX_TOTAL_COUNT) throw new Error(`细目表总量最多 ${MAX_TOTAL_COUNT} 题（当前 ${total}）`);
  return cells;
}

/** 汇总：总量、题型分布、难度分布、知识点数 —— 供界面与缺口提示使用 */
export function blueprintSummary(cells: BlueprintCell[]): {
  total: number;
  byType: { type: BlueprintType; count: number }[];
  byLevel: { level: BlueprintLevel; count: number }[];
  points: string[];
} {
  const byType = new Map<BlueprintType, number>();
  const byLevel = new Map<BlueprintLevel, number>();
  const points = new Set<string>();
  for (const c of cells) {
    byType.set(c.type, (byType.get(c.type) ?? 0) + c.count);
    byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + c.count);
    if (c.point) points.add(c.point);
  }
  return {
    total: cells.reduce((sum, c) => sum + c.count, 0),
    byType: BLUEPRINT_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, count: byType.get(t) ?? 0 })),
    byLevel: BLUEPRINT_LEVELS.filter((l) => byLevel.has(l)).map((l) => ({ level: l, count: byLevel.get(l) ?? 0 })),
    points: [...points],
  };
}

/**
 * 挑题顺序：**先填知识点多、数量大的格**。
 * 原因：题池里冷门知识点本来题少，先让它们抢到题；否则被大格抽完后冷门格全是缺口。
 */
export function orderCellsForPick(cells: BlueprintCell[]): BlueprintCell[] {
  return [...cells].sort((a, b) => b.count - a.count || a.point.localeCompare(b.point) || a.type.localeCompare(b.type));
}
