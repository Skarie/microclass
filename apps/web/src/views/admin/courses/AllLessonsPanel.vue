<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import LessonPickerTable from '@/components/lessons/LessonPickerTable.vue';
import LessonBatchBar from './LessonBatchBar.vue';
import type { Course, MediaRoot } from '@/api/types';
import type { useCourseLessons } from '@/composables/use-course-lessons';
import type { useLessonActions } from '@/composables/use-lesson-actions';

/**
 * 「全部课时」：跨课程检索表 + 勾选后的批量改绑 / 删除。
 * 数据、勾选状态来自 use-course-lessons，动作由 use-lesson-actions 提供。
 */
defineProps<{
  lessons: ReturnType<typeof useCourseLessons>;
  actions: ReturnType<typeof useLessonActions>;
  courses: Course[];
  roots: MediaRoot[];
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">全部课时（{{ lessons.filteredLessons.length }}）</span>
      <span class="mc-muted">跨课程检索：查空章节、查某个文件夹下的课时，或批量改绑/删除</span>
    </div>

    <LessonBatchBar
      v-if="lessons.allSelectedIds.length > 0"
      :count="lessons.allSelectedIds.length"
      @assign="actions.openAssign('all')"
      @remove="actions.removeSelected('all')"
      @clear="lessons.clearSelection('all')"
    />

    <div v-if="lessons.allLoading && lessons.allLessons.length === 0" class="loading">
      <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="lessons.filteredLessons.length === 0"
      icon="folder"
      title="没有匹配的课时"
      description="换个关键词或把课程筛选改成「全部课程」；也可以在课程里绑定文件夹扫描导入。"
    />

    <LessonPickerTable
      v-else
      :lessons="lessons.filteredLessons"
      :courses="courses"
      :roots="roots"
      :selected="lessons.allSelectedIds"
      show-course
      @toggle="lessons.toggleAllLesson"
      @toggle-all="lessons.toggleAllLessonsAll"
      @edit="actions.openLessonEdit"
      @knowledge="actions.openLessonKnowledge"
      @remove="actions.removeLesson"
    />
  </section>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 52px;
}
</style>
