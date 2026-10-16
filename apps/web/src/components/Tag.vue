<script setup lang="ts">
/**
 * 标签：状态/分类/难度统一外观（以前各页面自己拼 `mc-badge` + 内联色值）。
 */
import Icon from './Icon.vue';
import type { IconName } from './icons';

withDefaults(
  defineProps<{
    tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
    size?: 'sm' | 'md';
    icon?: IconName;
    /** 描边样式（弱化视觉，用于次要分类） */
    outline?: boolean;
  }>(),
  { tone: 'neutral', size: 'md', icon: undefined, outline: false },
);
</script>

<template>
  <span class="tag" :class="[`tag--${tone}`, `tag--${size}`, { 'tag--outline': outline }]">
    <Icon v-if="icon" :name="icon" :size="size === 'sm' ? 12 : 14" />
    <slot />
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--mc-radius-pill);
  font-weight: var(--mc-font-medium);
  white-space: nowrap;
  line-height: var(--mc-leading-display);
}

.tag--sm {
  padding: 4px 8px;
  font-size: var(--mc-text-xs);
}

.tag--md {
  padding: var(--mc-space-1) var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.tag--neutral {
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
}

.tag--primary {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.tag--success {
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.tag--warning {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.tag--danger {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.tag--info {
  background: var(--mc-info-soft);
  color: var(--mc-info-fg);
}

.tag--outline {
  background: transparent;
  border: 1px solid currentcolor;
}
</style>
