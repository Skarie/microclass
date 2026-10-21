import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import type { Category, Course } from '@/api/types';

/**
 * 课程列表状态：/courses 数据、关键词 / 分类筛选、列表 / 平铺偏好与统计。
 * 只读数据 + 筛选，增删改在 use-course-crud；课时在 use-course-lessons。
 */
export type ViewMode = 'grid' | 'list';

interface CourseListResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

/** 列表优先（结构规范：列表先于卡片网格，一屏能看到更多课程） */
const VIEW_KEY = 'mc.courseView';

function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function useCourseList() {
  const { data, loading, run } = useAsync<CourseListResponse>(() => api.get<CourseListResponse>('/courses'));

  const keyword = ref('');
  const categoryFilter = ref<number | ''>('');
  const view = ref<ViewMode>(readView());

  function setView(next: ViewMode): void {
    view.value = next;
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 隐私模式下写不了 localStorage，忽略即可 */
    }
  }

  const courses = computed(() => data.value?.courses ?? []);
  const categories = computed(() => data.value?.categories ?? []);
  const orphans = computed(() => data.value?.orphans ?? { total: 0, finished: 0, quiz: 0 });

  const filtered = computed(() =>
    courses.value.filter((c) => {
      if (categoryFilter.value !== '' && c.category_id !== categoryFilter.value) return false;
      const kw = keyword.value.trim().toLowerCase();
      if (!kw) return true;
      return `${c.name} ${c.description} ${c.category_name ?? ''}`.toLowerCase().includes(kw);
    }),
  );

  const publishedCount = computed(() => courses.value.filter((c) => c.published === 1).length);
  const boundCount = computed(() => courses.value.filter((c) => c.folder_root_id).length);

  return reactive({
    courses,
    categories,
    orphans,
    keyword,
    categoryFilter,
    view,
    filtered,
    publishedCount,
    boundCount,
    loading,
    load: run,
    setView,
  });
}
