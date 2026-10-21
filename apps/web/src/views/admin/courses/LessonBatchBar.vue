<script setup lang="ts">
/**
 * 课时批量操作条：已选计数 + 改绑 / 删除 / 取消选择。
 * 「全部课时」与「未归类课时」共用，按钮文案完全一致。
 */
defineProps<{ count: number }>();

const emit = defineEmits<{
  (e: 'assign'): void;
  (e: 'remove'): void;
  (e: 'clear'): void;
}>();
</script>

<template>
  <div class="batch-bar mc-row mc-row--wrap">
    <span class="batch-bar__count">已选 {{ count }} 个课时</span>
    <div class="mc-spacer" />
    <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('assign')">批量改绑到课程…</button>
    <button class="mc-btn mc-btn--danger mc-btn--sm" type="button" @click="emit('remove')">删除选中</button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('clear')">取消选择</button>
  </div>
</template>

<style scoped>
.batch-bar {
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-5);
  background: var(--mc-bg-sunken);
  border-bottom: 1px solid var(--mc-border);
}

.batch-bar__count {
  font-size: var(--mc-text-sm, 13px);
  font-weight: var(--mc-font-semibold);
}
</style>
