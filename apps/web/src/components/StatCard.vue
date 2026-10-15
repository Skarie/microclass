<script setup lang="ts">
/**
 * 指标卡：数值 + 标签 + 图标 + 环比/注解。
 * 用于页头下方的关键指标条（学习统计、总览仪表盘、题库体检等）。
 */
import Icon from './Icon.vue';
import type { IconName } from './icons';

withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    unit?: string;
    icon?: IconName;
    tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
    hint?: string;
    /** 环比：正数向上、负数向下 */
    trend?: { value: number; label?: string } | null;
    clickable?: boolean;
  }>(),
  { unit: '', icon: undefined, tone: 'neutral', hint: '', trend: null, clickable: false },
);
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="stat"
    :class="[`stat--${tone}`, { 'stat--clickable': clickable }]"
    :type="clickable ? 'button' : undefined"
  >
    <span v-if="icon" class="stat__icon"><Icon :name="icon" :size="18" /></span>
    <span class="stat__body">
      <span class="stat__label">{{ label }}</span>
      <span class="stat__value">
        {{ value }}<span v-if="unit" class="stat__unit">{{ unit }}</span>
      </span>
      <span v-if="$slots.visual" class="stat__visual"><slot name="visual" /></span>
      <span v-if="hint || trend" class="stat__foot">
        <span v-if="trend" class="stat__trend" :class="trend.value >= 0 ? 'stat__trend--up' : 'stat__trend--down'">
          <Icon :name="trend.value >= 0 ? 'trending-up' : 'trending-down'" :size="13" />
          {{ trend.value >= 0 ? '+' : '' }}{{ trend.value }}%
        </span>
        <span v-if="hint" class="stat__hint">{{ hint }}</span>
      </span>
    </span>
  </component>
</template>

<style scoped>
.stat {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
  min-width: 0;
  flex: 1 1 160px;
  padding: var(--mc-space-4);
  background: var(--mc-bg-elevated);
  background-image: var(--mc-gradient-surface);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  box-shadow: var(--mc-shadow-sm);
  text-align: left;
  transition: var(--mc-transition-all);
}

.stat--clickable {
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .stat:hover {
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-md);
    transform: translateY(var(--mc-hover-lift-sm));
  }
}

.stat__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--mc-radius-md);
  flex: none;
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  box-shadow: var(--mc-shadow-xs);
}

.stat--primary .stat__icon {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.stat--success .stat__icon {
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.stat--warning .stat__icon {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.stat--danger .stat__icon {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.stat--info .stat__icon {
  background: var(--mc-info-soft);
  color: var(--mc-info);
}

.stat__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.stat__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-tight);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
  font-variant-numeric: tabular-nums;
}

.stat__unit {
  margin-left: 3px;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.stat__foot {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.stat__trend {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: var(--mc-font-medium);
}

.stat__trend--up {
  color: var(--mc-success-fg);
}

.stat__trend--down {
  color: var(--mc-danger-fg);
}
.stat__visual {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin-top: var(--mc-space-1);
}
</style>
