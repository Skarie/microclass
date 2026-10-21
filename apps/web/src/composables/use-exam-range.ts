import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { FacetBook, FacetPoint } from '@/components/compose/types';

/** 第①步的范围选择：册次 / 章节 / 知识点三组勾选值。 */
export interface RangeSelection {
  books: string[];
  chapters: string[];
  points: string[];
}

/**
 * 组卷第①步：范围树数据（facets）、按章节懒加载知识点、知识点搜索与范围摘要。
 * 只负责"圈范围"，抽题/组卷方式不在这里。
 */
export function useExamRange({ getExamId }: { getExamId: () => number }) {
  const toast = useToastStore();
  const scope = ref<'course' | 'all'>('course');
  const selected = ref<RangeSelection>({ books: [], chapters: [], points: [] });
  const facets = ref<{ total: number; books: FacetBook[] } | null>(null);
  const pointsByChapter = ref<Record<string, FacetPoint[]>>({});
  const loadingPoints = ref<string | null>(null);
  const rangeLoading = ref(false);

  function filterPayload(): Record<string, string | string[]> {
    return {
      ...(scope.value === 'all' ? { scope: 'all' } : {}),
      ...(selected.value.books.length > 0 ? { books: selected.value.books } : {}),
      ...(selected.value.chapters.length > 0 ? { chapters: selected.value.chapters } : {}),
      ...(selected.value.points.length > 0 ? { points: selected.value.points } : {}),
    };
  }

  async function loadFacets(): Promise<void> {
    rangeLoading.value = true;
    try {
      facets.value = await api.get<{ total: number; books: FacetBook[] }>(
        `/exams/${getExamId()}/facets`,
        filterPayload(),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      rangeLoading.value = false;
    }
  }

  async function loadPointsOfChapter(chapter: string): Promise<void> {
    loadingPoints.value = chapter;
    try {
      const res = await api.get<{ points: FacetPoint[] }>(`/exams/${getExamId()}/points`, {
        ...filterPayload(),
        chapters: [chapter],
        limit: 200,
      });
      pointsByChapter.value = { ...pointsByChapter.value, [chapter]: res.points };
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      loadingPoints.value = null;
    }
  }

  async function searchPoints(keyword: string): Promise<void> {
    if (keyword === '') return;
    try {
      const res = await api.get<{ points: FacetPoint[] }>(`/exams/${getExamId()}/points`, {
        ...filterPayload(),
        pointKeyword: keyword,
        limit: 200,
      });
      const grouped: Record<string, FacetPoint[]> = {};
      for (const p of res.points) {
        const key = p.chapter || '（未标注章节）';
        grouped[key] = [...(grouped[key] ?? []), p];
      }
      pointsByChapter.value = { ...pointsByChapter.value, ...grouped };
      if (res.points.length === 0) toast.info('没有匹配的知识点');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const rangeSummary = computed(() => {
    const parts: string[] = [];
    if (selected.value.books.length > 0) parts.push(`${selected.value.books.length} 个册次`);
    if (selected.value.chapters.length > 0) parts.push(`${selected.value.chapters.length} 个章节`);
    if (selected.value.points.length > 0) parts.push(`${selected.value.points.length} 个知识点`);
    return parts.length === 0 ? '全部范围（本课程所有题）' : parts.join(' + ');
  });

  /** 跳到另一场考试时清空范围（原页面在路由 watch 里做的事）。 */
  function reset(): void {
    selected.value = { books: [], chapters: [], points: [] };
  }

  return reactive({
    scope,
    selected,
    facets,
    pointsByChapter,
    loadingPoints,
    rangeLoading,
    rangeSummary,
    filterPayload,
    loadFacets,
    loadPointsOfChapter,
    searchPoints,
    reset,
  });
}

export type ExamRange = ReturnType<typeof useExamRange>;
