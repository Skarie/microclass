<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { Lesson } from '@/api/types';

/** 观看页页头：面包屑（课程 › 章节 › 课时）、标题、简介与课后练习入口。 */
defineProps<{ lesson: Lesson; quizUnlocked: boolean }>();
const emit = defineEmits<{ (e: 'mark-finished'): void }>();
</script>

<template>
  <header class="watch__header mc-card">
    <div class="mc-col watch__title-block">
      <nav class="watch__crumbs" aria-label="面包屑">
        <RouterLink
          v-if="lesson.course_id !== null"
          class="watch__crumb"
          :to="{ name: 'course', params: { id: lesson.course_id } }"
        >
          <Icon name="arrow-left" :size="14" />
          返回课程
        </RouterLink>
        <template v-if="lesson.group_name">
          <Icon name="chevron-right" :size="14" class="watch__crumb-sep" />
          <span class="watch__crumb">{{ lesson.group_name }}</span>
        </template>
        <Icon name="chevron-right" :size="14" class="watch__crumb-sep" />
        <span class="watch__crumb watch__crumb--current">{{ lesson.title }}</span>
      </nav>
      <div class="mc-row mc-row--wrap watch__title-row">
        <h2 class="watch__title">{{ lesson.title }}</h2>
        <span v-if="lesson.progress?.finished === 1" class="mc-badge mc-badge--success">已学完</span>
      </div>
      <p v-if="lesson.description" class="mc-secondary watch__desc">{{ lesson.description }}</p>
    </div>

    <div class="mc-row mc-row--wrap watch__header-actions">
      <button
        v-if="lesson.video_kind !== 'local'"
        class="mc-btn mc-btn--sm"
        type="button"
        @click="emit('mark-finished')"
      >
        <Icon name="check" :size="16" />
        标记为已学完
      </button>
      <RouterLink
        class="mc-btn mc-btn--primary mc-btn--sm"
        :class="{ 'watch__quiz-locked': !quizUnlocked }"
        :to="{ name: 'quiz', params: { id: lesson.id } }"
      >
        <Icon name="pen-line" :size="16" />
        课后练习{{ lesson.progress?.quiz_done === 1 ? `（最好 ${lesson.progress.quiz_best}%）` : '' }}
      </RouterLink>
    </div>
  </header>
</template>

<style scoped>
.watch__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-5);
}

.watch__title-block {
  gap: var(--mc-space-2);
  min-width: 0;
}

/* 课时上下文：课程 › 章节 › 课时（学生看视频时最常问"我在哪一章"） */
.watch__crumbs {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  min-width: 0;
  flex-wrap: wrap;
}

.watch__crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--mc-text-muted);
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.watch__crumb:hover {
  color: var(--mc-primary-fg);
}

.watch__crumb--current {
  color: var(--mc-text-secondary);
  font-weight: var(--mc-font-medium);
}

.watch__crumb-sep {
  color: var(--mc-border-strong);
}

.watch__title-row {
  align-items: center;
  gap: var(--mc-space-2);
}

.watch__title {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  letter-spacing: var(--mc-tracking-tight);
}

.watch__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.watch__header-actions {
  flex: none;
}

/* 窄屏：动作按钮先让位到下一行。否则两枚 44px 的按钮把标题挤成一列 5 个字，
   标题与简介会竖排成"指/标/口/径"——最扎眼的移动端事故。 */
@media (max-width: 760px) {
  .watch__header {
    flex-direction: column;
    align-items: stretch;
    gap: var(--mc-space-3);
  }

  .watch__header-actions {
    justify-content: flex-start;
  }
}

.watch__quiz-locked {
  opacity: 0.7;
}
</style>
