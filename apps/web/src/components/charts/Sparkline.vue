<script setup lang="ts">
/**
 * 迷你趋势线：给 KPI 卡用的"一眼看走势"（不占地方、不抢主数字）。
 * 纯装饰 + aria-hidden，数值本身在 KPI 卡上有文字。
 */
import { computed } from 'vue';
import type { ChartTone } from '@/components/charts/types';
import { linePath, sparkline } from '@/utils/chart';

const props = withDefaults(
  defineProps<{
    values: number[];
    width?: number;
    height?: number;
    tone?: ChartTone;
  }>(),
  { width: 96, height: 26, tone: 'primary' },
);

const points = computed(() => sparkline(props.values, props.width, props.height));
const path = computed(() => linePath(points.value));

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
    v-if="values.length > 1"
    :viewBox="`0 0 ${width} ${height}`"
    :width="width"
    :height="height"
    class="spark"
    aria-hidden="true"
  >
    <path :d="`${path} L ${width} ${height} L 0 ${height} Z`" class="spark__area" :style="{ fill: strokeVar }" />
    <path :d="path" class="spark__line" :style="{ stroke: strokeVar }" />
  </svg>
</template>

<style scoped>
.spark {
  display: block;
  overflow: visible;
}

.spark__area {
  opacity: 0.14;
  stroke: none;
}

.spark__line {
  fill: none;
  stroke-width: 1.8;
  stroke-linejoin: round;
  stroke-linecap: round;
}
</style>
