<script setup lang="ts">
/**
 * 进度条：统一学习进度/任务进度外观（以前是裸 div + 内联宽度，还出现过"只剩一个点"的样子）。
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
      <div
        class="pb__bar"
        :class="[`pb__bar--${tone}`, { 'pb__bar--tiny': clamped > 0 && clamped < 6 }]"
        :style="{ width: `${clamped}%` }"
      />
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
  flex: 1;
  min-width: 40px;
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius-pill);
  overflow: hidden;
}

.pb--sm .pb__track {
  height: 6px;
}

.pb--md .pb__track {
  height: 10px;
}

.pb__bar {
  height: 100%;
  border-radius: var(--mc-radius-pill);
  transition: width var(--mc-duration) var(--mc-ease-out);
  background: var(--mc-primary);
}

/* 进度很小时（如 1/30 ≈ 3%）给一个最小可见宽度，否则看起来像"坏掉的一个点" */
.pb__bar--tiny {
  min-width: 8px;
}

.pb__bar--primary {
  background: linear-gradient(90deg, var(--mc-primary-400), var(--mc-primary));
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
