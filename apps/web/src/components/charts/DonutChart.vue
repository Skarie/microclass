<script setup lang="ts">
/**
 * 环形图（掌握度分布这类"占比一眼看懂"的场景）。
 *
 * 无障碍：整图给 `role="img"` + aria-label 概述；扇形是装饰（aria-hidden），
 * 数值另有图例列表（屏幕阅读器读图例更清楚）。
 * 颜色只走设计令牌（tone → CSS 变量），保证明暗主题与 design-guard 约束。
 */
import { computed } from 'vue';
import type { ChartTone } from '@/components/charts/types';
import { donutArcs } from '@/utils/chart';
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';

const props = withDefaults(
  defineProps<{
    segments: { label: string; value: number; tone?: ChartTone; icon?: IconName }[];
    size?: number;
    /** 圆心大数字（如知识点总数） */
    centerValue?: string | number;
    centerLabel?: string;
    /** 无障碍概述 */
    caption?: string;
  }>(),
  { size: 168, centerValue: undefined, centerLabel: '', caption: '' },
);

const view = 160;
const cx = view / 2;
const cy = view / 2;
const outer = 68;
const inner = 46;

const arcs = computed(() =>
  donutArcs(
    props.segments.map((s) => ({ label: s.label, value: s.value })),
    { cx, cy, outer, inner, gapDeg: 2 },
  ),
);

const total = computed(() => props.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0));

const toneVar = (tone: ChartTone | undefined): string => {
  switch (tone) {
    case 'success':
      return 'var(--mc-success)';
    case 'warning':
      return 'var(--mc-warning)';
    case 'danger':
      return 'var(--mc-danger)';
    case 'info':
      return 'var(--mc-info)';
    case 'neutral':
      return 'var(--mc-chart-2)';
    default:
      return 'var(--mc-primary)';
  }
};

const label = computed(
  () => props.caption || `环形图：${props.segments.map((s) => `${s.label} ${s.value}`).join('，')}`,
);

function percent(value: number): string {
  if (total.value <= 0) return '0%';
  return `${Math.round((value / total.value) * 100)}%`;
}
</script>

<template>
  <div class="donut">
    <svg :viewBox="`0 0 ${view} ${view}`" :width="size" :height="size" role="img" :aria-label="label">
      <circle :cx="cx" :cy="cy" :r="(outer + inner) / 2" class="donut__track" :stroke-width="outer - inner" />
      <path
        v-for="(arc, i) in arcs"
        :key="arc.label"
        :d="arc.path"
        aria-hidden="true"
        :style="{ fill: toneVar(segments[i]?.tone) }"
      />
      <text v-if="centerValue !== undefined" :x="cx" :y="cy - 2" class="donut__value" text-anchor="middle">
        {{ centerValue }}
      </text>
      <text v-if="centerLabel" :x="cx" :y="cy + 14" class="donut__label" text-anchor="middle">
        {{ centerLabel }}
      </text>
    </svg>

    <ul class="donut__legend">
      <li v-for="s in segments" :key="s.label" class="donut__item">
        <span class="donut__dot" :style="{ background: toneVar(s.tone) }" aria-hidden="true" />
        <Icon v-if="s.icon" :name="s.icon" :size="15" class="donut__icon" />
        <span class="donut__name">{{ s.label }}</span>
        <span class="donut__num">{{ s.value }}</span>
        <span class="donut__pct">{{ percent(s.value) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.donut {
  display: flex;
  align-items: center;
  gap: var(--mc-space-5);
  flex-wrap: wrap;
}

.donut__track {
  fill: none;
  stroke: var(--mc-bg-sunken);
}

.donut__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  fill: var(--mc-text);
}

.donut__label {
  font-size: var(--mc-text-xs);
  fill: var(--mc-text-muted);
}

.donut__legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  /* 限宽：否则数值/占比被拉到卡片最右边，中间留一大片空白 */
  min-width: 200px;
  max-width: 420px;
  flex: 0 1 420px;
}

.donut__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
}

.donut__dot {
  width: 10px;
  height: 10px;
  border-radius: var(--mc-radius-pill);
  flex: none;
}

.donut__icon {
  color: var(--mc-text-muted);
}

.donut__name {
  color: var(--mc-text-muted);
}

.donut__num {
  margin-left: auto;
  font-weight: var(--mc-font-medium);
}

.donut__pct {
  width: 44px;
  text-align: right;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}
</style>
