<script setup lang="ts">
import { computed } from 'vue';
import LessonFormModal from '@/components/lessons/LessonFormModal.vue';
import KnowledgeModal from '@/components/lessons/KnowledgeModal.vue';
import VideoUploadModal from '@/components/lessons/VideoUploadModal.vue';
import type { Course, MediaRoot } from '@/api/types';
import type { Tab } from './course-admin-types';
import type { useCourseLessons } from '@/composables/use-course-lessons';
import type { useLessonActions } from '@/composables/use-lesson-actions';

/**
 * 课时相关的三个弹窗：新建 / 编辑课时、知识点、上传视频。
 * 上传不指定课程（course-id 固定 null），与「全部 / 未归类课时」的入口一致。
 */
const props = defineProps<{
  actions: ReturnType<typeof useLessonActions>;
  lessons: ReturnType<typeof useCourseLessons>;
  courses: Course[];
  roots: MediaRoot[];
  tab: Tab;
}>();

/** 新建课时的默认排序：当前选项卡的课时数（与拆分前一致） */
const defaultSort = computed(() =>
  props.tab === 'orphans' ? props.lessons.orphanLessons.length : props.lessons.allLessons.length,
);
</script>

<template>
  <LessonFormModal
    :open="actions.lessonFormOpen"
    :lesson="actions.editingLesson"
    :roots="roots"
    :courses="courses"
    :default-sort="defaultSort"
    @close="actions.closeLessonForm()"
    @saved="actions.onLessonSaved"
  />

  <KnowledgeModal
    :open="actions.knOpen"
    :lesson="actions.knLesson"
    @close="actions.closeKnowledge()"
    @changed="actions.refreshAll"
  />

  <VideoUploadModal
    :open="actions.uploadOpen"
    :course-id="null"
    @close="actions.closeUpload"
    @uploaded="actions.onUploaded"
  />
</template>
