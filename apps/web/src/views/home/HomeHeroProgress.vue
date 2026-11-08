<script setup lang="ts">
/** 首页 Hero 的学习进度块：课时数字 + 百分比 + 白色进度条。 */
import ProgressBar from '@/components/ProgressBar.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course; progress: number }>();
</script>

<template>
  <div class="hero-progress">
    <div class="hero-progress__head">
      <span>
        已学完 <strong class="mc-num">{{ course.finished ?? 0 }}</strong> / {{ course.total ?? 0 }} 课时
      </span>
      <span class="hero-progress__percent mc-num">{{ progress }}%</span>
    </div>
    <ProgressBar :value="progress" tone="primary" :show-end="false" :aria-label="`${course.name} 学习进度`" />
  </div>
</template>

<style scoped>
.hero-progress {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  width: 100%;
  max-width: 440px;
  margin-top: var(--mc-space-2);
}

.hero-progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-hero-fg);
}

.hero-progress__percent {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
}

/* 进度条落在主色底上：轨道 / 填充改成白色系（只在本组件穿透一次） */
.hero-progress :deep(.pb__track) {
  background: color-mix(in srgb, var(--mc-hero-fg) 24%, transparent);
}

.hero-progress :deep(.pb__bar) {
  background: var(--mc-hero-fg);
}

.hero-progress :deep(.pb__end) {
  background: var(--mc-hero-fg);
}
</style>
