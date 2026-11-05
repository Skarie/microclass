<script setup lang="ts">
/**
 * 进度条：统一学习进度/任务进度外观。
 * 动画走 transform: scaleX()（不再动 width），条形末端用 accent 点提示「进行中」。
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 0-100 */
    value: number;
    tone?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
    size?: 'sm' | 'md';
    /** 右侧显示百分比 */
    showValue?: boolean;
    /** 条上叠加文字（如 "12/30"） */
    label?: string;
    /** 无可见标签时的可访问名（axe 要求 progressbar 必须有名字） */
    ariaLabel?: string;
  }>(),
  { tone: 'primary', size: 'sm', showValue: false, label: '', ariaLabel: '进度' },
);

const clamped = computed(() => Math.max(0, Math.min(100, Math.round(props.value))));
/** 进度很小时（如 1/30 ≈ 3%）保留一个最小可见刻度，否则看起来像坏掉的一个点 */
const fill = computed(() => (clamped.value === 0 ? 0 : Math.max(clamped.value, 3) / 100));
const showEnd = computed(() => clamped.value > 0 && clamped.value < 100);
</script>

<template>
  <div class="pb" :class="`pb--${size}`">
    <div
      class="pb__track"
      role="progressbar"
      :aria-valuenow="clamped"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label || ariaLabel"
    >
      <div class="pb__bar" :class="`pb__bar--${tone}`" :style="{ transform: `scaleX(${fill})` }" />
      <span v-if="showEnd" class="pb__end" :style="{ left: `${clamped}%` }" aria-hidden="true" />
    </div>
    <span v-if="label" class="pb__label">{{ label }}</span>
    <span v-else-if="showValue" class="pb__label">{{ clamped }}%</span>
  </div>
</template>

<style scoped>
.pb {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.pb__track {
  position: relative;
  flex: 1;
  min-width: 40px;
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius-pill);
}

.pb--sm .pb__track {
  height: 6px;
}

.pb--md .pb__track {
  height: 10px;
}

.pb__bar {
  width: 100%;
  height: 100%;
  border-radius: var(--mc-radius-pill);
  transform-origin: left center;
  transition: transform var(--mc-duration) var(--mc-ease-out);
  background: var(--mc-primary);
}

/* 学习进度末端的强调点：全站只有这一处用 accent 画"进行中" */
.pb__end {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-accent);
  transform: translate(-50%, -50%);
  transition: left var(--mc-duration) var(--mc-ease-out);
  pointer-events: none;
}

.pb__bar--primary {
  background: var(--mc-primary);
}

.pb__bar--success {
  background: var(--mc-success);
}

.pb__bar--warning {
  background: var(--mc-warning);
}

.pb__bar--danger {
  background: var(--mc-danger);
}

.pb__bar--neutral {
  background: var(--mc-neutral-400);
}

.pb__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
