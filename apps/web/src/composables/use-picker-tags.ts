/**
 * 组卷「自己挑题」里的标签筛选：候选、多选 + 任意/全部、写进题池查询串。
 *
 * 与题库筛选条共用 `FilterMultiSelect` 组件与后端同一套 `tagIds/tagMode` 语义，
 * 老师在建卷时能直接「只挑打了『易错』的题」，不用先回题库筛一遍再记题号。
 *
 * 单独成 composable：`QuestionPickerPanel.vue` 已接近行数上限（文件行数守卫），
 * 这块请求逻辑独立后，面板只保留「三区编排」。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { TagFilterMode, TagItem } from '@/api/tag';

export interface PickerTagsDeps {
  /** 筛选变化后重查题池（页码回 1） */
  refresh: () => Promise<void>;
}

export function usePickerTags(deps: PickerTagsDeps) {
  const toast = useToastStore();
  const tags = ref<TagItem[]>([]);
  const tagIds = ref<number[]>([]);
  const tagMode = ref<TagFilterMode>('any');

  /** 通用多选控件用字符串值 */
  const tagValues = computed(() => tagIds.value.map(String));
  const tagOptions = computed(() =>
    tags.value.map((tag) => ({ value: String(tag.id), label: tag.name, hint: `${tag.questionCount} 题` })),
  );

  async function loadTags(): Promise<void> {
    try {
      const res = await api.get<{ tags: TagItem[] }>('/tags');
      tags.value = res.tags;
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function onTagValues(values: string[]): void {
    tagIds.value = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    void deps.refresh();
  }

  function onTagMode(mode: TagFilterMode): void {
    tagMode.value = mode;
    if (tagIds.value.length > 0) void deps.refresh();
  }

  /** 拼进题池查询串（空 = 不筛） */
  function query(): { tagIds: string; tagMode: TagFilterMode } | Record<string, never> {
    if (tagIds.value.length === 0) return {};
    return { tagIds: tagIds.value.join(','), tagMode: tagMode.value };
  }

  function resetTags(): void {
    tagIds.value = [];
    tagMode.value = 'any';
  }

  return { tagIds, tagMode, tagValues, tagOptions, loadTags, onTagValues, onTagMode, query, resetTags };
}
