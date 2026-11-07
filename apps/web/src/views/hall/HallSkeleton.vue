<script setup lang="ts">
/**
 * 首屏加载骨架：与当前呈现方式一致（卡片/列表），避免数据回来时布局跳动。
 */
defineProps<{ viewMode: 'cards' | 'list' }>();
</script>

<template>
  <div v-if="viewMode === 'cards'" class="hall__cards" aria-hidden="true">
    <div v-for="i in 6" :key="i" class="hall__card-skeleton">
      <div class="mc-skeleton hall__skeleton-cover" />
      <div class="hall__skeleton-body">
        <div class="mc-skeleton hall__skeleton-line" />
        <div class="mc-skeleton hall__skeleton-line hall__skeleton-line--short" />
        <div class="mc-skeleton hall__skeleton-bar" />
      </div>
    </div>
  </div>

  <div v-else class="hall__list" aria-hidden="true">
    <div v-for="i in 6" :key="i" class="hall__row-skeleton">
      <div class="mc-skeleton hall__skeleton-thumb" />
      <div class="mc-skeleton hall__skeleton-line" />
      <div class="mc-skeleton hall__skeleton-line hall__skeleton-line--short" />
    </div>
  </div>
</template>

<style scoped>
.hall__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: var(--mc-space-4);
}

.hall__card-skeleton {
  overflow: hidden;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
}

.hall__skeleton-cover {
  height: 148px;
}

.hall__skeleton-body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4);
}

.hall__skeleton-line {
  height: 14px;
}

.hall__skeleton-line--short {
  width: 45%;
}

.hall__skeleton-bar {
  height: 6px;
  margin-top: var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
}

.hall__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hall__row-skeleton {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 180px;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-3);
}

.hall__skeleton-thumb {
  height: 40px;
  border-radius: var(--mc-radius-xs);
}
</style>
