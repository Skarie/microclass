<script setup lang="ts">
/**
 * 课程封面构图（首页横滑、推荐、大厅平铺、列表共用）：
 * 分类实底色 + 白色几何（同心圆 / 弧线 / 斜线 / 点阵）+ 课程名首字。
 * 不使用图片资源、不做渐变；颜色通过 categoryVars 注入，仍来自 tokens。
 */
import { computed } from 'vue';
import { categoryVars } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course; compact?: boolean }>();

const key = computed(() => props.course.category_name || props.course.name || '未分类');
const initial = computed(() => (props.course.name || '课').trim().slice(0, 1).toUpperCase());
</script>

<template>
  <div class="art" :class="{ 'art--compact': compact }" :style="categoryVars(key)">
    <svg v-if="!compact" class="art__geo" viewBox="0 0 320 148" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="266" cy="24" r="58" class="art__ring" />
      <circle cx="266" cy="24" r="34" class="art__ring art__ring--thin" />
      <path d="M-26 148A118 118 0 0 1 92 30" class="art__arc" />
      <path d="M168 168 300 36" class="art__line" />
      <path d="M208 168 304 72" class="art__line" />
      <path d="M20 30h116" class="art__dots" />
      <circle cx="300" cy="126" r="4" class="art__dot" />
    </svg>
    <span class="art__initial">{{ initial }}</span>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--cat-bg);
  color: var(--cat-on);
}

.art__geo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.art__ring {
  fill: none;
  stroke: currentcolor;
  stroke-opacity: 0.2;
  stroke-width: 1.5;
}

.art__ring--thin {
  stroke-opacity: 0.12;
}

.art__arc {
  fill: none;
  stroke: currentcolor;
  stroke-opacity: 0.14;
  stroke-width: 1.5;
}

.art__line {
  stroke: currentcolor;
  stroke-opacity: 0.16;
  stroke-width: 1.5;
}

.art__dots {
  stroke: currentcolor;
  stroke-opacity: 0.2;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 0 9;
}

.art__dot {
  fill: currentcolor;
  opacity: 0.24;
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

.art--compact .art__initial {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0;
}
</style>
