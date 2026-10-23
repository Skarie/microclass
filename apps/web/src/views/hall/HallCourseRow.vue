<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import type { Course } from '@/api/types';

/**
 * 课程大厅「列表」行（从 CourseHallView 抽出）：缩略图 + 标题/统计 + 进度 + 收藏/学习按钮。
 * 窄屏（≤900px）隐藏进度列，给标题和按钮让位。
 */
defineProps<{ course: Course; progress: number }>();
const emit = defineEmits<{ 'toggle-fav': [course: Course] }>();
</script>

<template>
  <li class="course-card course-card--row" :class="`course-card--g${Math.abs(course.id) % 6}`">
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
        <span class="course-card__stat">
          <Icon name="video" :size="13" />
          {{ course.total ?? 0 }} 课时
        </span>
        <span class="course-card__stat">
          <Icon name="check-circle" :size="13" />
          已完成 {{ course.finished ?? 0 }}
        </span>
        <Tag v-if="(course.quiz ?? 0) > 0" tone="success" size="sm" icon="pen-line"> 已练习 {{ course.quiz }} </Tag>
        <Tag v-if="course.published !== 1" tone="warning" size="sm">草稿</Tag>
      </div>
    </div>

    <div class="course-card__row-progress">
      <ProgressBar
        :value="progress"
        :tone="progress >= 100 ? 'success' : 'primary'"
        :label="`${course.finished ?? 0}/${course.total ?? 0}`"
      />
    </div>

    <div class="course-card__row-actions">
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
      <RouterLink
        class="mc-btn mc-btn--sm"
        :class="progress > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
        :to="{ name: 'course', params: { id: course.id } }"
      >
        {{ progress > 0 ? '继续学习' : '开始学习' }}
      </RouterLink>
    </div>
  </li>
</template>

<style scoped>
.course-card--row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 180px auto;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  transition: var(--mc-transition-colors);
}

@media (hover: hover) and (pointer: fine) {
  .course-card--row:hover {
    background: var(--mc-bg-hover);
  }
}

.course-card__thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 44px;
  border-radius: var(--mc-radius-sm);
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
  color: var(--mc-primary-fg);
  flex: none;
}

.course-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card--g1 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-2);
  color: var(--mc-accent-fg);
}
.course-card--g2 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-3);
  color: var(--mc-success-fg);
}
.course-card--g3 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-4);
  color: var(--mc-warning-fg);
}
.course-card--g5 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-6);
  color: var(--mc-seal-fg);
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

.course-card__row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

@media (max-width: 900px) {
  .course-card--row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
