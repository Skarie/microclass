<script setup lang="ts">
/**
 * 首页「我的课程」横滑卡：统一主色封面 + 中性状态 / 分类角标 + 进度 + 实心主色小按钮。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import { STATUS_LABEL, statusOf } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course; progress: number }>();

const status = computed(() => statusOf(props.course));
const statusTone = computed(() =>
  status.value === 'learning' ? 'primary' : status.value === 'finished' ? 'success' : 'neutral',
);
const actionLabel = computed(() => (props.progress >= 100 ? '复习' : props.progress > 0 ? '继续学习' : '开始学习'));
</script>

<template>
  <li class="rail-card mc-card">
    <div class="rail-card__cover">
      <CourseCoverArt :course="course" />
      <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
      <CourseCoverTag :label="STATUS_LABEL[status]" corner="right" :tone="statusTone" dot />
    </div>

    <div class="rail-card__body">
      <RouterLink class="rail-card__name" :to="{ name: 'course', params: { id: course.id } }">
        <span class="rail-card__name-text">{{ course.name }}</span>
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
      <RouterLink class="rail-card__cta" :to="{ name: 'course', params: { id: course.id } }">
        <Icon :name="progress >= 100 ? 'refresh' : 'play'" :size="14" />
        {{ actionLabel }}
      </RouterLink>
    </div>
  </li>
</template>

<style scoped>
.rail-card {
  position: relative;
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
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }

  .rail-card:hover :deep(.art) {
    transform: scale(1.03);
  }
}

.rail-card:focus-within {
  border-color: var(--mc-primary-border);
  box-shadow: var(--mc-shadow-xs);
  transform: translateY(var(--mc-hover-lift));
}

.rail-card:active {
  box-shadow: none;
  transform: scale(var(--mc-press-scale-soft));
}

.rail-card__cover {
  position: relative;
  display: block;
  height: 148px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
}

.rail-card__cover :deep(.art) {
  transition: transform var(--mc-duration) var(--mc-ease-out);
}

.rail-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  min-width: 0;
}

/* 拉伸链接：整卡可点，标题即入口（截断在内层 span 上，链接自身不能裁剪） */
.rail-card__name {
  display: block;
  min-height: calc(var(--mc-text-base) * var(--mc-leading) * 2);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading);
  color: var(--mc-text);
}

.rail-card__name-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.rail-card__name::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
}

.rail-card__name:hover,
.rail-card__name:focus-visible {
  color: var(--mc-primary-fg);
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

.rail-card__cta {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  margin-top: var(--mc-space-1);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  transition: var(--mc-transition-all);
}

.rail-card__cta:hover {
  background: var(--mc-primary-deep);
}

.rail-card__cta:active {
  transform: scale(var(--mc-press-scale));
}

.rail-card__cta:focus-visible {
  outline: var(--mc-focus-ring-width) solid var(--mc-primary);
  outline-offset: var(--mc-focus-ring-offset);
}

@media (max-width: 1023px) {
  .rail-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
