/**
 * 「课程关联」视图的数据：只列有题库的课程 + 未关联计数。
 *
 * 与文件夹视图并列，只负责课程侧；题库列表过滤在 use-bank-list 里读 selectedCourse。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { BankCourseSummary, CourseFilter } from '@/views/admin/bankTypes';

export function useBankCourses() {
  const toast = useToastStore();

  const courseSummary = ref<BankCourseSummary>({ courses: [], unbound: { bankCount: 0, questionCount: 0 } });
  const coursesLoading = ref(false);
  const selectedCourse = ref<CourseFilter>('all');

  const courses = computed(() => courseSummary.value.courses);
  const unboundCourses = computed(() => courseSummary.value.unbound);
  const courseBankTotal = computed(
    () => courses.value.reduce((sum, course) => sum + course.bankCount, 0) + unboundCourses.value.bankCount,
  );
  const selectedCourseName = computed(() => {
    if (selectedCourse.value === 'all') return '全部题库';
    if (selectedCourse.value === 'unbound') return '未关联课程';
    return courses.value.find((course) => course.courseId === selectedCourse.value)?.name ?? '全部题库';
  });

  async function loadCourseSummary(): Promise<void> {
    coursesLoading.value = true;
    try {
      courseSummary.value = await api.get<BankCourseSummary>('/banks/course-summary');
      if (
        typeof selectedCourse.value === 'number' &&
        !courses.value.some((course) => course.courseId === selectedCourse.value)
      ) {
        selectedCourse.value = 'all';
      }
    } catch (e) {
      toast.error(errorMessage(e));
      courseSummary.value = { courses: [], unbound: { bankCount: 0, questionCount: 0 } };
    } finally {
      coursesLoading.value = false;
    }
  }

  function selectCourse(filter: CourseFilter): void {
    selectedCourse.value = filter;
  }

  /** 后端只回课程名时，用课程关联列表反查课程 id（用于跳转课程管理页） */
  function findCourseIdByName(name: string): number | null {
    if (name === '') return null;
    return courses.value.find((course) => course.name === name)?.courseId ?? null;
  }

  return {
    courseSummary,
    courses,
    unboundCourses,
    coursesLoading,
    selectedCourse,
    selectedCourseName,
    courseBankTotal,
    loadCourseSummary,
    selectCourse,
    findCourseIdByName,
  };
}
