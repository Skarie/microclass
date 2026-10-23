import { reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Course, CourseStats, Lesson, LessonStats } from '@/api/types';
import type { StatsTab } from '@/views/admin/stats/stats-types';

interface CourseListResponse {
  courses: Course[];
}

interface LessonListResponse {
  lessons: Lesson[];
}

/**
 * 学习统计的数据与请求：课程/课时下拉、课时与课程两套统计、CSV 导出。
 *
 * 统计接口与参数、加载顺序、失败兜底都保持拆分前逐字一致：
 *   - 课时：`GET /stats/lessons/:id`；课程：`GET /stats/courses/:id`；
 *   - 列表：`GET /courses`、`GET /lessons?course=<id>`；
 *   - 课程变化时清空课程统计、重拉课时，当前页签立即重载；
 *   - 课时变化且停在课时页签时重拉课时统计。
 * 展示层派生（KPI 卡片、时间格式化）在 ./views/admin/stats/stats-types.ts。
 */
export function useStats() {
  const toast = useToastStore();

  const tab = ref<StatsTab>('lesson');
  const courses = ref<Course[]>([]);
  const courseId = ref<number | ''>('');
  const lessons = ref<Lesson[]>([]);
  const lessonId = ref<number | ''>('');
  const lessonsLoading = ref(false);

  const lessonStats = ref<LessonStats | null>(null);
  const lessonLoading = ref(false);

  const courseStats = ref<CourseStats | null>(null);
  const courseLoading = ref(false);

  async function loadCourses(): Promise<void> {
    try {
      const res = await api.get<CourseListResponse>('/courses');
      courses.value = res.courses;
      const first = res.courses[0];
      if (first && courseId.value === '') courseId.value = first.id;
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function loadLessons(): Promise<void> {
    if (courseId.value === '') {
      lessons.value = [];
      lessonId.value = '';
      lessonStats.value = null;
      return;
    }
    lessonsLoading.value = true;
    try {
      const res = await api.get<LessonListResponse>('/lessons', { course: Number(courseId.value) });
      lessons.value = res.lessons;
      const stillThere = lessons.value.some((l) => l.id === lessonId.value);
      const first = lessons.value[0];
      if (!stillThere && first) lessonId.value = first.id;
      if (lessons.value.length === 0) {
        lessonId.value = '';
        lessonStats.value = null;
      }
    } catch (e) {
      toast.error(errorMessage(e));
      lessons.value = [];
      lessonId.value = '';
      lessonStats.value = null;
    } finally {
      lessonsLoading.value = false;
    }
  }

  async function loadLessonStats(): Promise<void> {
    if (lessonId.value === '') {
      lessonStats.value = null;
      return;
    }
    lessonLoading.value = true;
    try {
      lessonStats.value = await api.get<LessonStats>(`/stats/lessons/${lessonId.value}`);
    } catch (e) {
      toast.error(errorMessage(e));
      lessonStats.value = null;
    } finally {
      lessonLoading.value = false;
    }
  }

  async function loadCourseStats(): Promise<void> {
    if (courseId.value === '') {
      courseStats.value = null;
      return;
    }
    courseLoading.value = true;
    try {
      courseStats.value = await api.get<CourseStats>(`/stats/courses/${courseId.value}`);
    } catch (e) {
      toast.error(errorMessage(e));
      courseStats.value = null;
    } finally {
      courseLoading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    if (tab.value === 'lesson') await loadLessonStats();
    else await loadCourseStats();
  }

  async function switchTab(next: StatsTab): Promise<void> {
    if (tab.value === next) return;
    tab.value = next;
    if (next === 'lesson') {
      if (lessons.value.length === 0) await loadLessons();
      await loadLessonStats();
    } else {
      await loadCourseStats();
    }
  }

  async function exportCsv(): Promise<void> {
    if (tab.value === 'lesson') {
      if (lessonId.value === '') {
        toast.warning('请先选择课时');
        return;
      }
      try {
        await api.download(`/stats/lessons/${lessonId.value}.csv`);
        toast.success('课时统计已开始下载');
      } catch (e) {
        toast.error(errorMessage(e));
      }
      return;
    }
    if (courseId.value === '') {
      toast.warning('请先选择课程');
      return;
    }
    try {
      await api.download(`/stats/courses/${courseId.value}.csv`);
      toast.success('课程统计已开始下载');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  watch(courseId, async () => {
    courseStats.value = null;
    await loadLessons();
    if (tab.value === 'lesson') await loadLessonStats();
    else await loadCourseStats();
  });

  watch(lessonId, () => {
    if (tab.value === 'lesson') void loadLessonStats();
  });

  /** 首屏：课程 → 课时 → 课时统计（课程默认选中首个，与拆分前一致）。 */
  async function init(): Promise<void> {
    await loadCourses();
    await loadLessons();
    await loadLessonStats();
  }

  return reactive({
    tab,
    courses,
    courseId,
    lessons,
    lessonId,
    lessonsLoading,
    lessonStats,
    lessonLoading,
    courseStats,
    courseLoading,
    refresh,
    switchTab,
    exportCsv,
    init,
  });
}

export type StatsState = ReturnType<typeof useStats>;
