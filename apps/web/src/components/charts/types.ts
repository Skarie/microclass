/**
 * 图表公共类型。
 *
 * 单独放一个文件（而不是写在 `.vue` 的 `<script setup>` 里）的原因：
 *   1. `<script setup>` 里不允许 export，类型没法被其它模块 import；
 *   2. 图表配色必须收敛成一个联合类型，页面里拼错 tone 要在 `npm run typecheck` 就报错，
 *      而不是运行时静默变默认色。
 */
import type { IconName } from '@/components/icons';

/** 图表可用色调（都映射到设计令牌，禁止硬编码色值） */
export type ChartTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** 横向条形榜的一行 */
export interface BarItem {
  key: string | number;
  label: string;
  /** 主条数值 */
  value: number;
  /** 满值（不传则取所有条目最大值） */
  max?: number;
  /** 叠在主条上的浅色部分（0–1 比例，如正确率条上叠错误部分） */
  overlay?: number;
  tone?: ChartTone;
  icon?: IconName;
  /** 右侧显示的值文本（默认显示 value） */
  valueText?: string;
  /** 次要说明（知识点、作答次数这类） */
  hint?: string;
  /** label 是否按富文本渲染（公式/图片题干） */
  richText?: boolean;
}
