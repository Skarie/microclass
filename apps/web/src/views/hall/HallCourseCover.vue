<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { Course } from '@/api/types';

/**
 * 平铺卡片的封面（从 CourseHallView 的卡片里抽出）：封面图 / 兜底图标 /
 * 分类角标 / 「已学完」章。整块是进入课程详情的链接。
 * 扁平化：所有课程共用中性底色 + 主色线性图标，不再按 id 轮换彩色渐变。
 */
defineProps<{ course: Course; progress: number }>();
</script>

<template>
  <RouterLink
    class="course-card__cover"
    :to="{ name: 'course', params: { id: course.id } }"
    tabindex="-1"
    :aria-label="`进入课程 ${course.name}`"
  >
    <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
    <span v-else class="course-card__cover-fallback" aria-hidden="true">
      <Icon name="graduation" :size="28" />
    </span>
    <span v-if="course.category_name" class="course-card__cover-chip">{{ course.category_name }}</span>
    <span v-if="progress >= 100" class="course-card__cover-done">
      <Icon name="check" :size="12" />
      已学完
    </span>
  </RouterLink>
</template>

<style scoped>
.course-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 132px;
  overflow: hidden;
  background: var(--mc-bg-sunken);
  border-bottom: 1px solid var(--mc-border);
  color: var(--mc-primary-fg);
}

.course-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card__cover-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.course-card__cover-chip {
  position: absolute;
  top: var(--mc-space-2);
  left: var(--mc-space-2);
  max-width: calc(100% - 48px);
  padding: 0 var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-card__cover-done {
  position: absolute;
  right: var(--mc-space-2);
  bottom: var(--mc-space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: 0 var(--mc-space-2);
  border-radius: var(--mc-radius-xs);
  background: var(--mc-success-soft);
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-success-fg);
}
</style>
