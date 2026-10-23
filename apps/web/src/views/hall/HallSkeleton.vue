<script setup lang="ts">
/**
 * 首屏加载骨架（从 CourseHallView 抽出）：只在「还没拿到课程」时出现，
 * 6 行占位，尺寸与紧凑列表行一致，避免数据回来时页面跳动。
 */
</script>

<template>
  <div class="hall__list" aria-hidden="true">
    <div v-for="i in 6" :key="i" class="hall__row-skeleton">
      <div class="mc-skeleton hall__skeleton-thumb" />
      <div class="mc-skeleton hall__skeleton-line" />
      <div class="mc-skeleton hall__skeleton-line hall__skeleton-line--short" />
    </div>
  </div>
</template>

<style scoped>
.hall__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hall__row-skeleton {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 180px;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-3);
}

.hall__skeleton-thumb {
  height: 44px;
  border-radius: var(--mc-radius-sm);
}

.hall__skeleton-line {
  height: 14px;
}

.hall__skeleton-line--short {
  width: 45%;
}
</style>
