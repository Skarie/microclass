<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import HallCourseCover from './HallCourseCover.vue';
import type { Course } from '@/api/types';

/**
 * 课程大厅「平铺」卡片：封面、简介、课时/完成/进度、悬停出现的行动按钮。
 *
 * 整卡可点：标题上的拉伸链接（::after 铺满卡片）负责导航，
 * 收藏按钮与行动按钮抬到它上面，保持各自的独立点击区。
 */
const props = defineProps<{ course: Course; progress: number }>();
const emit = defineEmits<{ 'toggle-fav': [course: Course] }>();

const done = computed(() => props.progress >= 100);
const actionLabel = computed(() => (done.value ? '复习' : props.progress > 0 ? '继续学习' : '开始学习'));
</script>

<template>
  <article class="course-card course-card--tile mc-card">
    <HallCourseCover :course="course" />

    <div class="course-card__body">
      <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
        <span class="course-card__name-text">{{ course.name }}</span>
      </RouterLink>

      <p v-if="course.description" class="course-card__desc">{{ course.description }}</p>

      <div class="course-card__meta">
        <span class="mc-num">{{ course.total ?? 0 }} 课时</span>
        <span aria-hidden="true">·</span>
        <span class="mc-num">已完成 {{ course.finished ?? 0 }}</span>
        <span aria-hidden="true">·</span>
        <span class="mc-num">{{ progress }}%</span>
      </div>

      <ProgressBar
        :value="progress"
        :tone="done ? 'success' : 'primary'"
        :show-end="false"
        :aria-label="`${course.name} 学习进度`"
      />

      <div class="course-card__actions">
        <RouterLink
          class="course-card__cta"
          :class="{ 'course-card__cta--done': done }"
          :to="{ name: 'course', params: { id: course.id } }"
        >
          <Icon :name="done ? 'refresh' : 'play'" :size="14" />
          {{ actionLabel }}
        </RouterLink>
        <button
          class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon course-card__fav"
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
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  transition: var(--mc-transition-all);
}

/* hover / 键盘焦点：同一套反馈（描边 + 抬 2px + 最轻阴影） */
@media (hover: hover) and (pointer: fine) {
  .course-card--tile:hover {
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }

  .course-card--tile:hover :deep(.cover__art) {
    transform: scale(1.03);
  }
}

.course-card--tile:focus-within {
  border-color: var(--mc-primary-border);
  box-shadow: var(--mc-shadow-xs);
  transform: translateY(var(--mc-hover-lift));
}

/* 按下：停掉抬升、轻微内缩 */
.course-card--tile:active {
  box-shadow: none;
  transform: scale(var(--mc-press-scale-soft));
}

.course-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4);
  min-width: 0;
}

/* 拉伸链接：标题即整卡入口（::after 铺满 .course-card--tile）。
   注意：截断必须放在内层 span 上 —— 链接自身 overflow:hidden 会把 ::after 一起裁掉。 */
.course-card__name {
  display: block;
  min-height: calc(var(--mc-text-md) * var(--mc-leading) * 2);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading);
  color: var(--mc-text);
  transition: color var(--mc-transition);
}

.course-card__name-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.course-card__name::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
}

.course-card__name:hover,
.course-card__name:focus-visible {
  color: var(--mc-primary-fg);
}

.course-card__desc {
  margin: 0;
  overflow: hidden;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-card__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* 行动区压在拉伸链接之上：收藏与主按钮仍可各自点击 */
.course-card__actions {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-top: auto;
  padding-top: var(--mc-space-1);
}

.course-card__cta {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  border: 1px solid var(--mc-primary-soft);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  transition: var(--mc-transition-all);
}

.course-card__cta--done {
  border-color: var(--mc-success-soft);
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

/* 行动区常驻可见：藏到 hover 里会让「继续学习」无处可寻，
   也会让拉伸链接盖住收藏按钮的命中区。悬停时只把主按钮从软色升为实心。 */
@media (hover: hover) and (pointer: fine) {
  .course-card--tile:hover .course-card__cta:not(.course-card__cta--done),
  .course-card--tile:focus-within .course-card__cta:not(.course-card__cta--done) {
    border-color: var(--mc-primary);
    background: var(--mc-primary);
    color: var(--mc-text-inverse);
  }

  .course-card__cta:not(.course-card__cta--done):hover {
    border-color: var(--mc-primary-deep);
    background: var(--mc-primary-deep);
  }
}

@media (max-width: 1023px) {
  .course-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
