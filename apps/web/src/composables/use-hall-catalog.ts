import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useAsync, errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { progressOf, statusOf } from '@/utils/course-meta';
import type { Category, Course } from '@/api/types';

/**
 * 课程大厅的数据与筛选状态：
 *  - `/courses` 的课程 + 分类；
 *  - 关键词 / 分类 / 只看收藏 / 只看未学完；
 *  - 分类 chips 的数量（按全部课程统计，搜索时保持稳定）；
 *  - 平铺（卡片）或列表的呈现偏好，落盘在 localStorage `mc.hall.view`；
 *  - 收藏切换、按分类分组、进度百分比。
 */
interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

export type HallViewMode = 'cards' | 'list';

export interface CategoryChip {
  id: number | '';
  name: string;
  count: number;
}

/* 呈现方式：卡片（对标中国大学 MOOC）或列表（一屏看更多） */
const VIEW_KEY = 'mc.hall.view';

function readViewMode(): HallViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export function useHallCatalog() {
  const toast = useToastStore();
  const { data, loading, run } = useAsync<CoursesResponse>(() => api.get<CoursesResponse>('/courses'));

  const viewMode = ref<HallViewMode>(readViewMode());
  function setViewMode(next: HallViewMode): void {
    viewMode.value = next;
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  const keyword = ref('');
  const categoryId = ref<number | ''>('');
  const onlyFav = ref(false);
  const onlyUnfinished = ref(false);

  const courses = computed(() => data.value?.courses ?? []);
  const categories = computed(() => data.value?.categories ?? []);

  /** 除分类外的筛选结果：分类 chips 的数量以此为准，搜索时数字也跟着变 */
  const baseFiltered = computed(() =>
    courses.value.filter((c) => {
      if (keyword.value && !`${c.name} ${c.description}`.toLowerCase().includes(keyword.value.toLowerCase()))
        return false;
      if (onlyFav.value && !c.fav) return false;
      if (onlyUnfinished.value && (c.total ?? 0) > 0 && (c.finished ?? 0) >= (c.total ?? 0)) return false;
      return true;
    }),
  );

  const filtered = computed(() =>
    categoryId.value === '' ? baseFiltered.value : baseFiltered.value.filter((c) => c.category_id === categoryId.value),
  );

  /** 「全部 N」+ 各分类数量：用全部课程统计，搜索时数字不跳动 */
  const categoryChips = computed<CategoryChip[]>(() => {
    const counts = new Map<number, number>();
    for (const course of courses.value) {
      if (course.category_id === null) continue;
      counts.set(course.category_id, (counts.get(course.category_id) ?? 0) + 1);
    }
    return [
      { id: '', name: '全部', count: courses.value.length },
      ...categories.value.map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0 })),
    ];
  });

  /** 当前分类名：用于结果区标题 */
  const activeCategoryName = computed(
    () => categories.value.find((c) => c.id === categoryId.value)?.name ?? '全部课程',
  );

  /** 欢迎条「继续上次学习」：在学课程里进度最高的一门 */
  const continueCourse = computed<Course | null>(() => {
    const learning = courses.value.filter((c) => statusOf(c) === 'learning');
    return learning.sort((a, b) => progressOf(b) - progressOf(a))[0] ?? null;
  });

  async function toggleFav(course: Course): Promise<void> {
    try {
      const res = await api.post<{ fav: boolean }>(`/courses/${course.id}/fav`);
      course.fav = res.fav;
      toast.success(res.fav ? `已收藏「${course.name}」` : `已取消收藏「${course.name}」`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const hasFilter = computed(
    () => Boolean(keyword.value) || categoryId.value !== '' || onlyFav.value || onlyUnfinished.value,
  );

  function setCategory(id: number | ''): void {
    categoryId.value = id;
  }

  function resetFilters(): void {
    keyword.value = '';
    categoryId.value = '';
    onlyFav.value = false;
    onlyUnfinished.value = false;
  }

  return reactive({
    loading,
    viewMode,
    keyword,
    categoryId,
    onlyFav,
    onlyUnfinished,
    courses,
    categories,
    categoryChips,
    activeCategoryName,
    continueCourse,
    filtered,
    hasFilter,
    progressOf,
    setViewMode,
    setCategory,
    toggleFav,
    resetFilters,
    refresh: run,
  });
}

/** 大厅组合式函数的返回类型（供各展示组件声明 props） */
export type HallCatalog = ReturnType<typeof useHallCatalog>;
