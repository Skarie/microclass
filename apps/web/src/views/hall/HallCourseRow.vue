<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import { STATUS_LABEL, statusOf } from '@/utils/course-meta';
import type { Course } from '@/api/types';

/** 课程大厅「列表」行：40px 中性首字块、状态、统计、进度与收藏/学习按钮。 */
const props = defineProps<{
  course: Course;
  progress: number;
}>();
const emit = defineEmits<{ 'toggle-fav': [course: Course] }>();

const status = computed(() => statusOf(props.course));
const statusTone = computed(() =>
  status.value === 'learning' ? 'primary' : status.value === 'finished' ? 'success' : 'neutral',
);
const actionLabel = computed(() =>
  status.value === 'finished' ? '复习' : props.progress > 0 ? '继续学习' : '开始学习',
);
</script>

<template>
  <li class="course-card course-card--row">
    <RouterLink
      class="course-card__thumb"
      :to="{ name: 'course', params: { id: course.id } }"
      tabindex="-1"
      :aria-label="`进入课程 ${course.name}`"
    >
      <CourseCoverArt :course="course" compact />
    </RouterLink>

    <div class="course-card__row-main">
      <div class="course-card__row-title">
        <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
          {{ course.name }}
        </RouterLink>
        <Tag :tone="statusTone" size="sm">{{ STATUS_LABEL[status] }}</Tag>
      </div>
      <div class="course-card__meta">
        <span class="course-card__stat">
          <Icon name="video" :size="13" />
          {{ course.total ?? 0 }} 课时
        </span>
        <span class="course-card__stat">
          <Icon name="check-circle" :size="13" />
          已完成 {{ course.finished ?? 0 }}
        </span>
        <Tag v-if="course.category_name" tone="neutral" size="sm">{{ course.category_name }}</Tag>
        <Tag v-if="(course.quiz ?? 0) > 0" tone="success" size="sm" icon="pen-line"> 已练习 {{ course.quiz }} </Tag>
      </div>
    </div>

    <div class="course-card__row-progress">
      <ProgressBar
        :value="progress"
        :tone="status === 'finished' ? 'success' : 'primary'"
        :show-end="false"
        :label="`${course.finished ?? 0}/${course.total ?? 0}`"
      />
    </div>

    <div class="course-card__row-actions">
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
      <RouterLink class="course-card__cta" :to="{ name: 'course', params: { id: course.id } }">
        {{ actionLabel }}
      </RouterLink>
    </div>
  </li>
</template>

<style scoped>
.course-card--row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 180px auto;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
}

@media (hover: hover) and (pointer: fine) {
  .course-card--row:hover {
    background: var(--mc-bg-hover);
  }
}

.course-card__thumb {
  display: inline-flex;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: var(--mc-radius-xs);
}

.course-card__row-main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.course-card__row-title {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.course-card__name {
  overflow: hidden;
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-card__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
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

.course-card__cta {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 var(--mc-space-3);
  border: 1px solid var(--mc-primary-soft);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

@media (max-width: 900px) {
  .course-card--row {
    grid-template-columns: 40px minmax(0, 1fr);
    row-gap: var(--mc-space-2);
  }

  .course-card__thumb {
    grid-row: 1 / span 2;
    align-self: start;
  }

  .course-card__row-actions {
    grid-column: 2;
    justify-content: flex-end;
  }

  .course-card__row-progress {
    display: none;
  }

  .course-card__name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
  }

  .course-card__meta {
    flex-wrap: wrap;
    row-gap: var(--mc-space-1);
  }

  .course-card__stat {
    white-space: nowrap;
  }
}

@media (max-width: 1023px) {
  .course-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
