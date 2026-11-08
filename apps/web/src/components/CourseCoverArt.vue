<script setup lang="ts">
/**
 * 课程封面：统一主色实底 + 课程名首字，不再按分类取色，也不画几何装饰。
 * 分类信息只由卡片上的中性标签表达；列表缩略图用中性块 + 首字。
 */
import { computed } from 'vue';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course; compact?: boolean }>();

const initial = computed(() => (props.course.name || '课').trim().slice(0, 1).toUpperCase());
</script>

<template>
  <div class="art" :class="{ 'art--compact': compact }" aria-hidden="true">
    <span class="art__initial">{{ initial }}</span>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 主色压深一档：浅色/暗色主题下白字都能过 4.5:1 */
  background: color-mix(in srgb, var(--mc-primary) 72%, var(--mc-player-bg));
  color: var(--mc-hero-fg);
}

.art__initial {
  position: absolute;
  bottom: var(--mc-space-2);
  left: var(--mc-space-4);
  font-size: var(--mc-text-4xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-cn);
  opacity: 0.92;
}

.art--compact {
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
}

.art--compact .art__initial {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0;
  opacity: 1;
}
</style>
