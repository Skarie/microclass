<script setup lang="ts">
import { reactive } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { CourseFilter } from './bankTypes';

/**
 * 「课程关联」视图：只列有题库的课程 + 未关联行。
 * 点击课程后右侧题库列表按 `courseId` 过滤；未关联对应 `courseId=unbound`。
 */
const props = defineProps<{ catalog: ReturnType<typeof useBankCatalog> }>();
const catalogApi = props.catalog;
const catalogState = reactive(catalogApi);

function pick(filter: CourseFilter): void {
  void catalogState.pickCourse(filter);
}
</script>

<template>
  <div class="course-nav">
    <div v-if="catalogState.coursesLoading && catalogState.courses.length === 0" class="course-nav__loading">
      <div v-for="i in 4" :key="i" class="mc-skeleton course-nav__skeleton" />
    </div>

    <EmptyState
      v-else-if="catalogState.courses.length === 0 && catalogState.unboundCourses.bankCount === 0"
      icon="courses"
      title="还没有关联课程的题库"
      description="在题库表单里关联课时/课程后，这里会按课程汇总。"
    />

    <ul v-else class="course-list">
      <li class="course-row" :class="{ 'course-row--active': catalogState.selectedCourse === 'all' }">
        <button class="course-row__main" type="button" @click="pick('all')">
          <Icon name="bank" :size="15" class="course-row__icon" />
          <span class="course-row__text">
            <span class="course-row__name mc-truncate">全部题库</span>
            <span class="course-row__meta mc-muted">{{ catalogState.courseBankTotal }} 个题库</span>
          </span>
        </button>
      </li>

      <li class="course-row" :class="{ 'course-row--active': catalogState.selectedCourse === 'unbound' }">
        <button class="course-row__main" type="button" @click="pick('unbound')">
          <Icon name="folder" :size="15" class="course-row__icon course-row__icon--muted" />
          <span class="course-row__text">
            <span class="course-row__name mc-truncate">未关联课程</span>
            <span class="course-row__meta mc-muted">
              {{ catalogState.unboundCourses.bankCount }} 库 / {{ catalogState.unboundCourses.questionCount }} 题
            </span>
          </span>
        </button>
      </li>

      <li
        v-for="course in catalogState.courses"
        :key="course.courseId"
        class="course-row"
        :class="{ 'course-row--active': catalogState.selectedCourse === course.courseId }"
      >
        <button class="course-row__main" type="button" @click="pick(course.courseId)">
          <Icon name="courses" :size="15" class="course-row__icon" />
          <span class="course-row__text">
            <span class="course-row__name mc-truncate" :title="course.name">{{ course.name }}</span>
            <span class="course-row__meta mc-muted"> {{ course.bankCount }} 库 / {{ course.questionCount }} 题 </span>
          </span>
        </button>
      </li>
    </ul>

    <button
      class="mc-btn mc-btn--ghost mc-btn--sm course-nav__rebind"
      type="button"
      :disabled="catalogState.rebinding"
      @click="catalogState.rebind"
    >
      <Icon name="refresh" :size="15" />
      {{ catalogState.rebinding ? '匹配中…' : '自动匹配课程归属' }}
    </button>
  </div>
</template>

<style scoped>
.course-nav {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--mc-space-3) var(--mc-space-3);
}

.course-nav__loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-2) 0;
}

.course-nav__skeleton {
  height: 36px;
}

.course-list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.course-row {
  display: flex;
  border-radius: var(--mc-radius);
  transition: background var(--mc-transition);
}

.course-row:hover {
  background: var(--mc-bg-hover);
}

.course-row--active {
  background: var(--mc-primary-soft);
}

.course-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.course-row__icon {
  flex: none;
  color: var(--mc-primary-fg);
}

.course-row__icon--muted {
  color: var(--mc-text-muted);
}

.course-row__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  flex: 1;
}

.course-row__name {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.course-row__meta {
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}

.course-nav__rebind {
  margin-top: var(--mc-space-2);
  align-self: flex-start;
}
</style>
