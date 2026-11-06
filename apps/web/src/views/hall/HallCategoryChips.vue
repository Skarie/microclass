<script setup lang="ts">
/**
 * 课程大厅 · 分类 chips：`全部 N` + 各分类数量。
 * 选中态实心主色；数量来自 use-hall-catalog（搜索/收藏筛选会同步更新）。
 */
import type { HallCatalog } from '@/composables/use-hall-catalog';

defineProps<{ catalog: HallCatalog }>();
</script>

<template>
  <nav class="chips" aria-label="课程分类">
    <button
      v-for="chip in catalog.categoryChips"
      :key="chip.id === '' ? 'all' : chip.id"
      class="chips__item"
      :class="{ 'chips__item--on': catalog.categoryId === chip.id }"
      type="button"
      :aria-pressed="catalog.categoryId === chip.id"
      @click="catalog.setCategory(chip.id)"
    >
      {{ chip.name }}
      <span class="chips__count mc-num">{{ chip.count }}</span>
    </button>
  </nav>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.chips__item {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  padding: 0 var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.chips__item:hover {
  border-color: var(--mc-primary-border);
  color: var(--mc-primary-fg);
}

.chips__item--on {
  border-color: var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

.chips__item--on:hover {
  border-color: var(--mc-primary-hover);
  background: var(--mc-primary-hover);
  color: var(--mc-text-inverse);
}

.chips__item:focus-visible {
  outline: none;
  box-shadow: var(--mc-focus-ring);
}

.chips__count {
  opacity: 0.72;
}

@media (max-width: 1023px) {
  .chips__item {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
