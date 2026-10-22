<script setup lang="ts">
/**
 * 左栏二级/三级导航的返回条：← 全部课程 / 当前课程或册次。
 * 课程/册次层与题库列表层共用同一套样式，避免两处各写一份。
 */
defineProps<{
  label: string;
}>();

const emit = defineEmits<{
  back: [];
}>();
</script>

<template>
  <div class="nav-crumb">
    <button class="nav-crumb__back" type="button" @click="emit('back')">← 全部课程</button>
    <span class="mc-muted mc-truncate">{{ label }}</span>
  </div>
</template>

<style scoped>
.nav-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--mc-text-sm);
}

.nav-crumb__back {
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  color: var(--mc-text);
  font-size: var(--mc-text-xs);
  cursor: pointer;
}

.nav-crumb__back:hover {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
}
</style>
