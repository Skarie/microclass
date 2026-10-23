<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { Course } from '@/api/types';

/**
 * 平铺卡片的封面（从 CourseHallView 的卡片里抽出）：封面图 / 兜底图标 /
 * 分类角标 / 「已学完」章。整块是进入课程详情的链接，渐变底色按课程 id 轮转。
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
      <Icon name="graduation" :size="30" />
    </span>
    <span v-if="course.category_name" class="course-card__cover-chip">{{ course.category_name }}</span>
    <span v-if="progress >= 100" class="course-card__cover-done">
      <Icon name="check" :size="13" />
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
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
  color: var(--mc-primary-fg);
}

.course-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card--g1 .course-card__cover {
  color: var(--mc-accent-fg);
}
.course-card--g2 .course-card__cover {
  color: var(--mc-success-fg);
}
.course-card--g3 .course-card__cover {
  color: var(--mc-warning-fg);
}
.course-card--g5 .course-card__cover {
  color: var(--mc-seal-fg);
}

.course-card__cover-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
}

.course-card__cover-chip {
  position: absolute;
  top: var(--mc-space-2);
  left: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-elevated);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.course-card__cover-done {
  position: absolute;
  right: var(--mc-space-2);
  bottom: var(--mc-space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-success-soft);
  font-size: var(--mc-text-xs);
  color: var(--mc-success-fg);
}
</style>
