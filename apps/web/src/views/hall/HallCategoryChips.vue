<script setup lang="ts">
/**
 * 课程大厅 · 分类 chips：中性底 + 中性文字，选中态用主色实心；
 * 分类不再各占一色，数量来自 use-hall-catalog。
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
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.chips__item:hover {
  border-color: var(--mc-border-strong);
  color: var(--mc-text);
}

.chips__item--on,
.chips__item--on:hover {
  border-color: var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

.chips__item:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
}

.chips__count {
  color: currentcolor;
}

@media (max-width: 1023px) {
  .chips__item {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
