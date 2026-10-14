<script setup lang="ts">
/**
 * 进度环：KPI 卡上的"百分比一眼看懂"（正确率、覆盖率这类 0–100% 的指标）。
 * 用 stroke-dasharray 画弧，不依赖图表库；颜色走令牌。
 */
import { computed } from 'vue';
import type { ChartTone } from '@/components/charts/types';

const props = withDefaults(
  defineProps<{
    /** 0–1 */
    value: number;
    size?: number;
    thickness?: number;
    tone?: ChartTone;
    /** 环内文字（默认显示百分比） */
    text?: string;
    /** 无障碍名（必须给，屏幕阅读器读这个） */
    label?: string;
  }>(),
  { size: 52, thickness: 6, tone: 'primary', text: '', label: '' },
);

const radius = computed(() => (props.size - props.thickness) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const dash = computed(() => `${Math.min(1, Math.max(0, props.value)) * circumference.value} ${circumference.value}`);
const percentText = computed(() => props.text || `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`);

const strokeVar = computed(() => {
  switch (props.tone) {
    case 'success':
      return 'var(--mc-success)';
    case 'warning':
      return 'var(--mc-warning)';
    case 'danger':
      return 'var(--mc-danger)';
    case 'info':
      return 'var(--mc-chart-2)';
    default:
      return 'var(--mc-primary)';
  }
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    class="ring"
    role="img"
    :aria-label="label || `进度 ${percentText}`"
  >
    <circle :cx="size / 2" :cy="size / 2" :r="radius" class="ring__track" :stroke-width="thickness" fill="none" />
    <circle
      :cx="size / 2"
      :cy="size / 2"
      :r="radius"
      :stroke-dasharray="dash"
      :stroke-width="thickness"
      :style="{ stroke: strokeVar }"
      fill="none"
      stroke-linecap="round"
      class="ring__bar"
    />
    <text :x="size / 2" :y="size / 2 + 4" class="ring__text" text-anchor="middle">{{ percentText }}</text>
  </svg>
</template>

<style scoped>
.ring {
  flex: none;
}

.ring__track {
  stroke: var(--mc-bg-sunken);
}

.ring__bar {
  transform: rotate(-90deg);
  transform-origin: center;
}

.ring__text {
  font-size: 12px;
  font-weight: var(--mc-font-semibold);
  fill: var(--mc-text);
}
</style>
