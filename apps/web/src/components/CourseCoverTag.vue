<script setup lang="ts">
/**
 * 封面角标：分类文字（左上）与状态（右上）共用。
 * 统一中性软底 + 中性文字；状态只在 6px 圆点上用语义色，文字本身始终可读。
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
  background: color-mix(in srgb, var(--mc-bg-elevated) 92%, transparent);
  color: var(--mc-text-secondary);
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

.cover-tag__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-text-muted);
}

.cover-tag--primary .cover-tag__dot {
  background: var(--mc-primary);
}

.cover-tag--success .cover-tag__dot {
  background: var(--mc-success);
}
</style>
