<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import LessonAdminHeader from './lessons/LessonAdminHeader.vue';
import CourseFolderCard from './lessons/CourseFolderCard.vue';
import CourseKnowledgeCard from './lessons/CourseKnowledgeCard.vue';
import LessonListCard from './lessons/LessonListCard.vue';
import LessonBindModal from './lessons/LessonBindModal.vue';
import LessonFolderPickerModal from './lessons/LessonFolderPickerModal.vue';
import LessonScanModal from './lessons/LessonScanModal.vue';
import CourseLessonDialogs from './lessons/CourseLessonDialogs.vue';
import { useCourseLessonManage } from '@/composables/use-course-lesson-manage';
import { useCourseFolder } from '@/composables/use-course-folder';
import { useLessonScan } from '@/composables/use-lesson-scan';
import { useLessonOrder } from '@/composables/use-lesson-order';
import { useCourseLessonActions } from '@/composables/use-course-lesson-actions';

/**
 * 课程课时管理（课程内操作课时）：
 *   1. 课程绑定一个视频文件夹（课程文件夹）；
 *   2. 点「扫描」把文件夹里的视频导入成课时（子文件夹 = 章节），以后加了新课再扫一次即可；
 *   3. 课时列表支持拖拽排序，顺序按课程保存（老师手工排好的顺序不会被扫描打乱）。
 *
 * 页面只做编排：数据 / 文件夹 / 扫描 / 排序 / 课时动作在 composables/use-course-*.ts、
 * use-lesson-*.ts，界面按区块拆到 ./lessons/*，弹窗收口在 CourseLessonDialogs。
 */
const route = useRoute();
const courseId = computed(() => Number(route.params.id));

const manage = useCourseLessonManage({ courseId: () => courseId.value });
const folder = useCourseFolder({
  courseId: () => courseId.value,
  getFolder: () => manage.folder,
  getRoots: () => manage.roots,
  reload: manage.load,
});
const scan = useLessonScan({
  courseId: () => courseId.value,
  getFolder: () => manage.folder,
  openBind: folder.openBind,
  reload: manage.load,
});
const order = useLessonOrder({
  courseId: () => courseId.value,
  getLessons: () => manage.lessons,
  setLessons: (next) => {
    manage.lessons = next;
  },
});
const actions = useCourseLessonActions({ courseId: () => courseId.value, reload: manage.load });

onMounted(() => {
  void manage.load();
  void manage.loadRoots();
});
</script>

<template>
  <section class="page mc-col">
    <LessonAdminHeader
      :course="manage.course"
      :lesson-count="manage.lessons.length"
      :chapter-count="manage.chapterCount"
      :loading="manage.loading"
      :probing="actions.probing"
      :probe-progress="actions.probeProgress"
      :scanning="scan.scanning"
      @refresh="manage.load()"
      @probe="actions.probePending()"
      @upload="actions.uploadOpen = true"
      @create="actions.openCreate()"
      @scan="scan.openScan()"
    />

    <CourseFolderCard
      :folder="manage.folder"
      :scanning="scan.scanning"
      @scan="scan.openScan()"
      @bind="folder.openBind()"
      @unbind="folder.unbind()"
    />

    <CourseKnowledgeCard :exporting="actions.exporting" @export-knowledge="actions.exportKnowledge" />

    <LessonListCard
      :manage="manage"
      :order="order"
      @upload="actions.uploadOpen = true"
      @create="actions.openCreate()"
      @scan="scan.openScan()"
      @edit="actions.openEdit"
      @knowledge="actions.openKnowledge"
      @delete="actions.removeLesson"
    />

    <LessonBindModal :folder="folder" :roots="manage.roots" />
    <LessonFolderPickerModal :folder="folder" />
    <LessonScanModal :scan="scan" />

    <CourseLessonDialogs
      :actions="actions"
      :course-id="courseId"
      :course="manage.course"
      :lessons="manage.lessons"
      :roots="manage.roots"
    />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}
</style>
