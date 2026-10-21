<script setup lang="ts">
/** 课时列表里的章节小标题（只在每组第一行前出现一次）。 */
defineProps<{
  name: string;
  count: number;
}>();
</script>

<template>
  <li class="chapter">
    <span class="chapter__name">{{ name || '未分章' }}</span>
    <span class="mc-muted chapter__count">{{ count }} 课时</span>
  </li>
</template>

<style scoped>
.chapter {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-5);
  background: var(--mc-bg-sunken);
  border-top: 1px solid var(--mc-border);
  border-bottom: 1px solid var(--mc-border);
}

.chapter__name {
  font-weight: var(--mc-font-semibold);
  font-size: var(--mc-text-sm, 13px);
}

.chapter__count {
  font-size: var(--mc-text-xs);
}
</style>
