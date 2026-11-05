<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import HallCourseCover from './HallCourseCover.vue';
import type { Course } from '@/api/types';

/**
 * 课程大厅「平铺」卡片（从 CourseHallView 抽出）：封面由 HallCourseCover 负责，
 * 这里放标题、课时/完成数、进度条、开始/继续学习与收藏按钮。
 */
defineProps<{ course: Course; progress: number }>();
const emit = defineEmits<{ 'toggle-fav': [course: Course] }>();
</script>

<template>
  <article class="course-card course-card--tile mc-card mc-card--interactive">
    <HallCourseCover :course="course" :progress="progress" />

    <div class="course-card__tile-body">
      <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
        {{ course.name }}
      </RouterLink>
      <div class="course-card__meta">
        <span class="course-card__stat">
          <Icon name="video" :size="13" />
          {{ course.total ?? 0 }} 课时
        </span>
        <span class="course-card__stat">
          <Icon name="check-circle" :size="13" />
          已完成 {{ course.finished ?? 0 }}
        </span>
        <Tag v-if="course.published !== 1" tone="warning" size="sm">草稿</Tag>
      </div>
      <ProgressBar
        :value="progress"
        :tone="progress >= 100 ? 'success' : 'primary'"
        :label="`${course.finished ?? 0}/${course.total ?? 0}`"
      />
      <div class="course-card__tile-actions">
        <RouterLink
          class="mc-btn mc-btn--sm"
          :class="progress > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
          :to="{ name: 'course', params: { id: course.id } }"
        >
          {{ progress > 0 ? '继续学习' : '开始学习' }}
        </RouterLink>
        <button
          class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
          :class="{ 'course-card__fav--on': course.fav }"
          type="button"
          :aria-label="course.fav ? '取消收藏' : '收藏课程'"
          :title="course.fav ? '取消收藏' : '收藏课程'"
          @click="emit('toggle-fav', course)"
        >
          <Icon name="star" :size="16" :filled="course.fav" />
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.course-card--tile {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

/* 扁平卡片的悬停：描边变主色、标题变主色，不抬升、不加阴影 */
@media (hover: hover) and (pointer: fine) {
  .course-card--tile:hover {
    border-color: var(--mc-primary);
  }

  .course-card--tile:hover .course-card__name {
    color: var(--mc-primary-fg);
  }
}

.course-card__tile-body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4);
  min-width: 0;
}

.course-card__tile-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-top: var(--mc-space-1);
}

.course-card__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-card__name:hover {
  color: var(--mc-primary-fg);
}

.course-card--tile .course-card__name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  min-height: calc(var(--mc-text-base) * 1.5 * 2);
}

.course-card__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.course-card__stat {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}
</style>
