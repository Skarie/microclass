<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 筛选状态由 useCourseLessons 持有，子组件就地编辑 */
import Icon from '@/components/Icon.vue';
import type { Course } from '@/api/types';
import type { useCourseLessons } from '@/composables/use-course-lessons';

/**
 * 「全部课时」筛选行：关键词 / 课程筛选、统计与刷新/上传/新建入口。
 */
defineProps<{ lessons: ReturnType<typeof useCourseLessons>; courses: Course[] }>();
const emit = defineEmits<{ (e: 'upload'): void; (e: 'create'): void }>();
</script>

<template>
  <div class="mc-row mc-row--wrap toolbar__row">
    <input
      v-model.trim="lessons.lessonKeyword"
      class="mc-input toolbar__search"
      type="search"
      placeholder="搜索课时标题、章节或视频路径"
      aria-label="搜索课时"
    />
    <select v-model="lessons.lessonCourseFilter" class="mc-select toolbar__select" aria-label="按课程筛选课时">
      <option value="">全部课程</option>
      <option value="orphan">未归类</option>
      <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <span class="mc-muted toolbar__count">
      共 {{ lessons.allLessons.length }} 个课时 · 空章节 {{ lessons.emptyChapterCount }} 个 · 当前筛选
      {{ lessons.filteredLessons.length }} 个
    </span>
    <div class="mc-spacer" />
    <button class="mc-btn mc-btn--sm" type="button" :disabled="lessons.allLoading" @click="lessons.loadAllLessons()">
      刷新
    </button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('upload')">
      <Icon name="upload" :size="16" /> 上传视频
    </button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('create')">新建课时</button>
  </div>
</template>

<style scoped>
.toolbar__row {
  align-items: center;
}

.toolbar__search {
  width: 240px;
}

.toolbar__select {
  width: 170px;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

@media (max-width: 900px) {
  .toolbar__search,
  .toolbar__select {
    width: 100%;
  }
}
</style>
