import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useAsync, errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Category, Course } from '@/api/types';

/**
 * 课程大厅的数据与筛选状态（从 CourseHallView 抽出）：
 *  - `/courses` 的课程 + 分类；
 *  - 关键词 / 分类 / 只看收藏 / 只看未学完；
 *  - 平铺（卡片）或列表的呈现偏好，落盘在 localStorage `mc.hall.view`；
 *  - 收藏切换、按分类分组、进度百分比。
 * 只读浏览 + 收藏，不负责课程的增删改。
 */
interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

export type HallViewMode = 'cards' | 'list';

/* 呈现方式：卡片（对标中国大学 MOOC）或列表（一屏看更多） */
const VIEW_KEY = 'mc.hall.view';

function readViewMode(): HallViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

function progressOf(course: Course): number {
  const total = course.total ?? 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
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

  const filtered = computed(() =>
    courses.value.filter((c) => {
      if (keyword.value && !`${c.name} ${c.description}`.toLowerCase().includes(keyword.value.toLowerCase()))
        return false;
      if (categoryId.value !== '' && c.category_id !== categoryId.value) return false;
      if (onlyFav.value && !c.fav) return false;
      if (onlyUnfinished.value && (c.total ?? 0) > 0 && (c.finished ?? 0) >= (c.total ?? 0)) return false;
      return true;
    }),
  );

  /** 按分类分组（无分类归入"未分类"） */
  const groups = computed(() => {
    const map = new Map<string, Course[]>();
    for (const c of filtered.value) {
      const key = c.category_name || '未分类';
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return [...map.entries()].map(([name, list]) => ({ name, list }));
  });

  async function toggleFav(course: Course): Promise<void> {
    try {
      const res = await api.post<{ fav: boolean }>(`/courses/${course.id}/fav`);
      course.fav = res.fav;
      toast.success(res.fav ? '已加入我的收藏' : '已取消收藏');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const hasFilter = computed(
    () => Boolean(keyword.value) || categoryId.value !== '' || onlyFav.value || onlyUnfinished.value,
  );

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
    filtered,
    groups,
    hasFilter,
    progressOf,
    setViewMode,
    toggleFav,
    resetFilters,
    refresh: run,
  });
}

/** 大厅组合式函数的返回类型（供各展示组件声明 props） */
export type HallCatalog = ReturnType<typeof useHallCatalog>;
