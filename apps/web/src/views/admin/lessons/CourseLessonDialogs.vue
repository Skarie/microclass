<script setup lang="ts">
import VideoUploadModal from '@/components/lessons/VideoUploadModal.vue';
import LessonFormModal from '@/components/lessons/LessonFormModal.vue';
import KnowledgeModal from '@/components/lessons/KnowledgeModal.vue';
import type { Course, Lesson, MediaRoot } from '@/api/types';
import type { useCourseLessonActions } from '@/composables/use-course-lesson-actions';

/**
 * 课程课时管理页的三个课时弹窗：上传视频 / 新建·编辑课时 / 知识点。
 * 打开状态与保存后的刷新都在 use-course-lesson-actions。
 */
defineProps<{
  actions: ReturnType<typeof useCourseLessonActions>;
  courseId: number;
  course: Course | null;
  lessons: Lesson[];
  roots: MediaRoot[];
}>();
</script>

<template>
  <!-- 上传视频（与课程管理的「未归类课时」共用同一套上传逻辑） -->
  <VideoUploadModal
    :open="actions.uploadOpen"
    :course-id="courseId"
    :course-name="course?.name"
    @close="actions.closeUpload"
    @uploaded="actions.onUploaded"
  />

  <LessonFormModal
    :open="actions.formOpen"
    :locked-course-id="courseId"
    :locked-course-name="course?.name"
    :lesson="actions.editingLesson"
    :roots="roots"
    :default-sort="lessons.length"
    @close="actions.closeForm"
    @saved="actions.onSaved"
  />

  <KnowledgeModal :open="actions.knOpen" :lesson="actions.knLesson" @close="actions.closeKnowledge" />
</template>
