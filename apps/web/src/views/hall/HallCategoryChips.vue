<script setup lang="ts">
/**
 * 课程大厅 · 分类 chips：每个分类用它自己的分类色（soft 底 + fg 文字），
 * 选中态切到该分类的实心色 + 白字；数量来自 use-hall-catalog。
 */
import { categoryVars } from '@/utils/course-meta';
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
      :style="categoryVars(chip.id === '' ? '' : chip.name)"
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
  border: 1px solid var(--cat-soft);
  border-radius: var(--mc-radius-pill);
  background: var(--cat-soft);
  color: var(--cat-fg);
  font: inherit;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.chips__item:hover {
  border-color: var(--cat-fg);
}

.chips__item--on,
.chips__item--on:hover {
  /* 选中态比封面再压深一档：14px 白字在深色主题也过 4.5:1 */
  border-color: color-mix(in srgb, var(--cat-bg) 74%, var(--mc-player-bg));
  background: color-mix(in srgb, var(--cat-bg) 74%, var(--mc-player-bg));
  color: var(--cat-on);
}

.chips__item:focus-visible {
  outline: 2px solid var(--cat-fg);
  outline-offset: 2px;
}

.chips__count {
  /* 计数与分类名同等可读：不用透明度压对比度（axe 会拦） */
  color: currentcolor;
}

@media (max-width: 1023px) {
  .chips__item {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
