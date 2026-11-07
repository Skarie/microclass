<script setup lang="ts">
/**
 * 封面角标：分类 chip（左上）与状态徽标（右上）共用。
 * 半透明白底保证图片上的可读性；状态同时用文字 + 圆点，颜色不是唯一信息载体。
 */
withDefaults(
  defineProps<{
    label: string;
    corner?: 'left' | 'right';
    tone?: 'neutral' | 'primary' | 'success';
    dot?: boolean;
  }>(),
  { corner: 'left', tone: 'neutral', dot: false },
);
</script>

<template>
  <span class="cover-tag" :class="[`cover-tag--${corner}`, `cover-tag--${tone}`]">
    <span v-if="dot" class="cover-tag__dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.cover-tag {
  position: absolute;
  top: var(--mc-space-2);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  max-width: calc(50% - var(--mc-space-3));
  padding: 0 var(--mc-space-2);
  overflow: hidden;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
  background: color-mix(in srgb, var(--mc-bg-elevated) 90%, transparent);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cover-tag--left {
  left: var(--mc-space-2);
}

.cover-tag--right {
  right: var(--mc-space-2);
}

.cover-tag--neutral {
  color: var(--mc-text-secondary);
}

/* 状态徽标用语义色软底，分类 chip 保持白色半透底 */
.cover-tag--primary {
  border-color: var(--mc-primary-border);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.cover-tag--success {
  border-color: var(--mc-success-soft);
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.cover-tag__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--mc-radius-pill);
  background: currentcolor;
}
</style>
