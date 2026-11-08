<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import CourseAdminTabs from './courses/CourseAdminTabs.vue';
import CoursesFilterBar from './courses/CoursesFilterBar.vue';
import LessonsFilterBar from './courses/LessonsFilterBar.vue';
import OrphansFilterBar from './courses/OrphansFilterBar.vue';
import RootsFilterBar from './courses/RootsFilterBar.vue';
import CourseListView from './courses/CourseListView.vue';
import AllLessonsPanel from './courses/AllLessonsPanel.vue';
import OrphanLessonsPanel from './courses/OrphanLessonsPanel.vue';
import MediaRootsPanel from './courses/MediaRootsPanel.vue';
import CourseAdminDialogs from './courses/CourseAdminDialogs.vue';
import CourseLessonDialogs from './courses/CourseLessonDialogs.vue';
import { useCourseList } from '@/composables/use-course-list';
import { useCategoryAdmin } from '@/composables/use-category-admin';
import { useCourseLessons } from '@/composables/use-course-lessons';
import { useLessonActions } from '@/composables/use-lesson-actions';
import { useMediaRoots } from '@/composables/use-media-roots';
import { useCourseCrud } from '@/composables/use-course-crud';
import type { Course } from '@/api/types';
import type { Tab } from './courses/course-admin-types';

/**
 * 课程管理（四个选项卡：课程 / 全部课时 / 未归类课时 / 媒体目录）。
 * 页面只做编排：数据与请求在四个组合式函数里，界面按区块拆到 ./courses/*，
 * 弹窗收口在 CourseAdminDialogs / CourseLessonDialogs。
 */
const router = useRouter();
const tab = ref<Tab>('courses');
const coverInput = ref<HTMLInputElement | null>(null);

const list = useCourseList();
const categoryAdmin = useCategoryAdmin({ reloadCourses: list.load });
const media = useMediaRoots({ refreshAll });
const lessons = useCourseLessons();
const actions = useLessonActions({
  getCourses: () => list.courses,
  getSelectedIds: (scope) => (scope === 'all' ? lessons.allSelectedIds : lessons.orphanSelectedIds),
  clearSelection: lessons.clearSelection,
  refreshAll,
});
const crud = useCourseCrud({
  getCourses: () => list.courses,
  reloadCourses: list.load,
  refreshAll,
  coverInput,
});

async function refreshAll(): Promise<void> {
  await list.load();
  await Promise.all([media.loadRoots(), lessons.loadAllLessons(), lessons.loadOrphans()]);
}

function openManage(course: Course): void {
  void router.push({ name: 'admin-course-lessons', params: { id: course.id } });
}

onMounted(() => void refreshAll());

watch(tab, (next) => {
  if (next === 'lessons') void lessons.loadAllLessons();
  if (next === 'orphans') void lessons.loadOrphans();
  if (next === 'roots') void media.loadRoots();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="课程管理"
      description="维护课程、章节与课时；绑定宿主机视频文件夹后可批量扫描导入，支持拖拽排序。"
      icon="courses"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '课程管理' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="list.loading" @click="refreshAll()">
          <span v-if="list.loading" class="mc-btn__spinner" aria-hidden="true" />
          <Icon v-else name="refresh" :size="15" />
          {{ list.loading ? '刷新中…' : '刷新' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="categoryAdmin.openCategories()">
          <Icon name="list" :size="15" />
          分类管理
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="crud.openCreate()">
          <Icon name="plus" :size="15" />
          新建课程
        </button>
      </template>
    </PageHeader>

    <div class="toolbar mc-card">
      <CourseAdminTabs
        :tab="tab"
        :course-count="list.courses.length"
        :lesson-count="lessons.allLessons.length"
        :orphan-count="list.orphans.total"
        :root-count="media.roots.length"
        @update:tab="tab = $event"
      />

      <CoursesFilterBar v-if="tab === 'courses'" :list="list" />
      <LessonsFilterBar
        v-else-if="tab === 'lessons'"
        :lessons="lessons"
        :courses="list.courses"
        @upload="actions.openUpload()"
        @create="actions.openLessonCreate()"
      />
      <OrphansFilterBar
        v-else-if="tab === 'orphans'"
        :lessons="lessons"
        @upload="actions.openUpload()"
        @create="actions.openLessonCreate()"
      />
      <RootsFilterBar v-else :media="media" />
    </div>

    <CourseListView
      v-if="tab === 'courses'"
      :list="list"
      :roots="media.roots"
      :menu-items="crud.courseMenuItems"
      @manage="openManage"
      @edit="crud.openEdit"
      @cover="crud.pickCover"
      @delete="crud.removeCourse"
      @create="crud.openCreate()"
    />
    <AllLessonsPanel
      v-else-if="tab === 'lessons'"
      :lessons="lessons"
      :actions="actions"
      :courses="list.courses"
      :roots="media.roots"
    />
    <OrphanLessonsPanel
      v-else-if="tab === 'orphans'"
      :lessons="lessons"
      :actions="actions"
      :courses="list.courses"
      :roots="media.roots"
    />
    <MediaRootsPanel v-else :media="media" />

    <input
      ref="coverInput"
      class="hidden-input"
      type="file"
      accept="image/*"
      aria-hidden="true"
      tabindex="-1"
      @change="crud.onCoverPicked"
    />

    <CourseAdminDialogs
      :crud="crud"
      :category-admin="categoryAdmin"
      :actions="actions"
      :media="media"
      :categories="list.categories"
      :courses="list.courses"
      :orphan-total="list.orphans.total"
    />
    <CourseLessonDialogs
      :actions="actions"
      :lessons="lessons"
      :courses="list.courses"
      :roots="media.roots"
      :tab="tab"
    />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4) var(--mc-space-5);
}

.hidden-input {
  display: none;
}
</style>
