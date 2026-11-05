<script setup lang="ts">
/**
 * 最近在学 · 单行课程卡片：封面、名称、课时统计、进度与「继续学习」。
 * 行内样式（含渐变缩略图与窄屏收敛）跟着行组件走，避免父级 scoped 失效。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course; progress: number }>();
</script>

<template>
  <li class="recent__row course-card course-card--row">
    <RouterLink
      class="course-card__thumb"
      :to="{ name: 'course', params: { id: course.id } }"
      tabindex="-1"
      :aria-label="`进入课程 ${course.name}`"
    >
      <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
      <Icon v-else name="graduation" :size="20" />
    </RouterLink>
    <div class="course-card__row-main">
      <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
        {{ course.name }}
      </RouterLink>
      <div class="course-card__meta">
        <span class="course-card__stat"><Icon name="video" :size="13" />{{ course.total ?? 0 }} 课时</span>
        <span class="course-card__stat">
          <Icon name="check-circle" :size="13" />已完成 {{ course.finished ?? 0 }}
        </span>
        <Tag v-if="course.category_name" tone="primary" size="sm">{{ course.category_name }}</Tag>
      </div>
    </div>
    <div class="course-card__row-progress">
      <ProgressBar
        :value="progress"
        :tone="progress >= 100 ? 'success' : 'primary'"
        :label="`${course.finished ?? 0}/${course.total ?? 0}`"
      />
    </div>
    <RouterLink class="mc-btn mc-btn--sm mc-btn--soft" :to="{ name: 'course', params: { id: course.id } }">
      继续学习
    </RouterLink>
  </li>
</template>

<style scoped>
.recent__row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 160px auto;
  align-items: center;
  gap: var(--mc-space-4);
  min-height: 64px;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  border-bottom: 1px solid var(--mc-border);
  transition: background-color var(--mc-transition);
}

.recent__row:last-child {
  border-bottom: 0;
}

@media (hover: hover) and (pointer: fine) {
  .recent__row:hover {
    background: var(--mc-bg-hover);
  }
}

.course-card__thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 44px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  overflow: hidden;
  /* 统一中性缩略图：中性底 + 单色纹理，不再按课程 id 轮换橙/紫渐变 */
  background-color: var(--mc-bg-sunken);
  background-image: var(--mc-cover-pattern);
  color: var(--mc-primary-fg);
  flex: none;
}

.course-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card__row-main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
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

@media (max-width: 900px) {
  .recent__row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
