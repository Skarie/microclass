<script setup lang="ts">
import CourseFormModal from './CourseFormModal.vue';
import CategoryManagerModal from './CategoryManagerModal.vue';
import AssignLessonsModal from './AssignLessonsModal.vue';
import AddMediaRootModal from './AddMediaRootModal.vue';
import FsPickerModal from './FsPickerModal.vue';
import type { Category, Course } from '@/api/types';
import type { useCategoryAdmin } from '@/composables/use-category-admin';
import type { useCourseCrud } from '@/composables/use-course-crud';
import type { useLessonActions } from '@/composables/use-lesson-actions';
import type { useMediaRoots } from '@/composables/use-media-roots';

/**
 * 课程管理页的五个操作弹窗（课程表单 / 分类 / 批量改绑 / 添加媒体目录 / 目录选择）。
 * 只为页面收口弹窗编排，状态全部来自各自的组合式函数。
 */
defineProps<{
  crud: ReturnType<typeof useCourseCrud>;
  categoryAdmin: ReturnType<typeof useCategoryAdmin>;
  actions: ReturnType<typeof useLessonActions>;
  media: ReturnType<typeof useMediaRoots>;
  categories: Category[];
  courses: Course[];
  orphanTotal: number;
}>();
</script>

<template>
  <CourseFormModal :crud="crud" :categories="categories" />
  <CategoryManagerModal
    :category-admin="categoryAdmin"
    :categories="categories"
    :courses="courses"
    :orphan-total="orphanTotal"
  />
  <AssignLessonsModal :actions="actions" :courses="courses" />
  <AddMediaRootModal :media="media" />
  <FsPickerModal :media="media" />
</template>
