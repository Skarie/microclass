/**
 * 题库内「标签」筛选（迁移 0030）：多选 + 任意/全部，候选来自 `/tags`。
 *
 * 单独成 composable 是因为 `use-question-list` 已接近行数上限（文件行数守卫 300 行），
 * 而这块状态与请求都能独立测；`applyTo` 只负责把筛选写进查询串，方便两个列表（题库内/跨库）复用。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { TagFilterMode, TagItem } from '@/api/tag';

export function useQuestionTags(onFilterChange: () => void) {
  const toast = useToastStore();
  const tagFilter = ref<number[]>([]);
  const tagMode = ref<TagFilterMode>('any');
  const tagOptions = ref<TagItem[]>([]);
  const optionsLoading = ref(false);

  const hasTagFilter = computed(() => tagFilter.value.length > 0);
  /** 通用多选控件用的是字符串值 */
  const tagFilterValues = computed(() => tagFilter.value.map(String));
  const tagFilterOptions = computed(() =>
    tagOptions.value.map((tag) => ({ value: String(tag.id), label: tag.name, hint: `${tag.questionCount} 题` })),
  );

  async function loadTagOptions(): Promise<void> {
    if (optionsLoading.value) return;
    optionsLoading.value = true;
    try {
      const res = await api.get<{ tags: TagItem[] }>('/tags');
      tagOptions.value = res.tags;
    } catch (e) {
      // 候选失败不影响题目列表；下次展开会重试
      toast.error(errorMessage(e));
    } finally {
      optionsLoading.value = false;
    }
  }

  function setTagFilterValues(values: string[]): void {
    tagFilter.value = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    onFilterChange();
  }

  function setTagMode(mode: TagFilterMode): void {
    if (tagMode.value === mode) return;
    tagMode.value = mode;
    if (hasTagFilter.value) onFilterChange();
  }

  /** 把筛选写进查询串（空 = 不筛） */
  function applyTo(params: URLSearchParams): void {
    if (!hasTagFilter.value) return;
    params.set('tagIds', tagFilter.value.join(','));
    params.set('tagMode', tagMode.value);
  }

  function resetTagFilter(): void {
    tagFilter.value = [];
    tagMode.value = 'any';
  }

  return {
    tagFilter,
    tagMode,
    tagOptions,
    tagFilterValues,
    tagFilterOptions,
    hasTagFilter,
    loadTagOptions,
    setTagFilterValues,
    setTagMode,
    applyTo,
    resetTagFilter,
  };
}

export type QuestionTagsFilterApi = ReturnType<typeof useQuestionTags>;
