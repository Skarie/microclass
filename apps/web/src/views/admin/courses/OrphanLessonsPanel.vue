<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import LessonPickerTable from '@/components/lessons/LessonPickerTable.vue';
import LessonBatchBar from './LessonBatchBar.vue';
import type { Course, MediaRoot } from '@/api/types';
import type { useCourseLessons } from '@/composables/use-course-lessons';
import type { useLessonActions } from '@/composables/use-lesson-actions';

/**
 * 「未归类课时」：没有归属的课时列表 + 批量改绑 / 删除。
 * 与「全部课时」共用 LessonPickerTable / LessonBatchBar，只是不显示课程列。
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
      <span class="mc-card__title">未归类课时（{{ lessons.orphanLessons.length }}）</span>
      <span class="mc-muted">勾选后可批量改绑到某门课程，也能顺手把章节统一</span>
    </div>

    <LessonBatchBar
      v-if="lessons.orphanSelectedIds.length > 0"
      :count="lessons.orphanSelectedIds.length"
      @assign="actions.openAssign('orphans')"
      @remove="actions.removeSelected('orphans')"
      @clear="lessons.clearSelection('orphans')"
    />

    <div v-if="lessons.orphanLoading && lessons.orphanLessons.length === 0" class="loading">
      <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="lessons.orphanLessons.length === 0"
      icon="folder"
      title="没有未归类课时"
      description="所有课时都归属到课程了。新上传的视频如果没选课程，会先出现在这里。"
      action-text="上传视频"
      @action="actions.openUpload()"
    />

    <LessonPickerTable
      v-else
      :lessons="lessons.orphanLessons"
      :courses="courses"
      :roots="roots"
      :selected="lessons.orphanSelectedIds"
      @toggle="lessons.toggleOrphan"
      @toggle-all="lessons.toggleAllOrphans"
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
