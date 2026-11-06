<script setup lang="ts">
/**
 * 首页「我的课程」横滑卡片：封面（或分类 tint）、状态徽标、名称、进度。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import { STATUS_LABEL, statusOf, tintVars } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course; progress: number }>();

const status = computed(() => statusOf(props.course));
const statusTone = computed(() =>
  status.value === 'learning' ? 'primary' : status.value === 'finished' ? 'success' : 'neutral',
);
</script>

<template>
  <li class="rail-card mc-card">
    <RouterLink
      class="rail-card__cover"
      :style="tintVars(course)"
      :to="{ name: 'course', params: { id: course.id } }"
      tabindex="-1"
      :aria-label="`进入课程 ${course.name}`"
    >
      <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
      <Icon v-else name="graduation" :size="32" />
      <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
      <CourseCoverTag :label="STATUS_LABEL[status]" corner="right" :tone="statusTone" dot />
    </RouterLink>

    <div class="rail-card__body">
      <RouterLink class="rail-card__name" :to="{ name: 'course', params: { id: course.id } }">
        {{ course.name }}
      </RouterLink>
      <div class="rail-card__meta">
        <span class="mc-num">{{ course.finished ?? 0 }}/{{ course.total ?? 0 }} 课时</span>
        <span class="mc-num">{{ progress }}%</span>
      </div>
      <ProgressBar
        :value="progress"
        :tone="progress >= 100 ? 'success' : 'primary'"
        :show-end="false"
        :aria-label="`${course.name} 学习进度`"
      />
    </div>
  </li>
</template>

<style scoped>
.rail-card {
  display: flex;
  flex: 0 0 232px;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  scroll-snap-align: start;
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .rail-card:hover {
    border-color: var(--mc-primary);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }
}

.rail-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 132px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
  background-color: var(--cover-tint);
  background-image: var(--mc-cover-pattern);
  color: var(--cover-ink);
}

.rail-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rail-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  min-width: 0;
}

.rail-card__name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  min-height: calc(var(--mc-text-base) * var(--mc-leading) * 2);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading);
  color: var(--mc-text);
}

.rail-card__name:hover {
  color: var(--mc-primary-fg);
}

.rail-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
