<script setup lang="ts">
/**
 * 首页 Hero 右侧的课程图像区（208px 高）。
 * 有真封面用真图，没有就用与大厅同一套「设计封面」——Hero 与卡片共用一种视觉语言。
 */
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course }>();
</script>

<template>
  <div class="hero-aside" aria-hidden="true">
    <CourseCoverArt :course="course" variant="hero" />
  </div>
</template>

<style scoped>
.hero-aside {
  display: flex;
  flex: none;
  align-items: stretch;
  width: 320px;
  max-width: 34%;
  height: 208px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mc-hero-fg) 24%, transparent);
  border-radius: var(--mc-radius-md);
}

@media (max-width: 1100px) {
  .hero-aside {
    width: 260px;
    height: 184px;
  }
}

@media (max-width: 900px) {
  .hero-aside {
    display: none;
  }
}
</style>
