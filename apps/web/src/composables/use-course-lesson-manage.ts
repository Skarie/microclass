import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import type { Course, CourseManageResponse, Lesson, MediaRoot } from '@/api/types';

/**
 * 课程课时管理页的数据层：课程 / 课时 / 媒体目录 / 课程文件夹。
 * 页面只做编排，行模型（章节只在组首显示一次）也在这里算好。
 */
interface MediaRootsResponse {
  mediaRoots: MediaRoot[];
}

/** 课时列表的一行：lesson + 序号 + 是否要渲染章节小标题 */
export interface LessonRowModel {
  lesson: Lesson;
  index: number;
  showChapter: boolean;
}

export interface CourseLessonManageDeps {
  courseId: () => number;
}

export function useCourseLessonManage(deps: CourseLessonManageDeps) {
  const { data, loading, run } = useAsync<CourseManageResponse>(
    () => api.get<CourseManageResponse>(`/courses/${deps.courseId()}/manage`),
    { immediate: false },
  );

  const roots = ref<MediaRoot[]>([]);
  const lessons = ref<Lesson[]>([]);

  const course = computed<Course | null>(() => data.value?.course ?? null);
  const folder = computed<CourseManageResponse['folder']>(() => data.value?.folder ?? null);

  const rows = computed<LessonRowModel[]>(() =>
    lessons.value.map((lesson, index) => ({
      lesson,
      index,
      showChapter: index === 0 || lessons.value[index - 1]?.group_name !== lesson.group_name,
    })),
  );

  const chapterCount = computed(() => new Set(lessons.value.map((l) => l.group_name).filter(Boolean)).size);

  async function load(): Promise<void> {
    await run();
    lessons.value = [...(data.value?.lessons ?? [])];
  }

  async function loadRoots(): Promise<void> {
    try {
      const res = await api.get<MediaRootsResponse>('/media-roots');
      roots.value = res.mediaRoots;
    } catch {
      roots.value = [];
    }
  }

  return reactive({
    course,
    folder,
    lessons,
    roots,
    loading,
    rows,
    chapterCount,
    load,
    loadRoots,
  });
}
