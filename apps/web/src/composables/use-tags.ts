/**
 * 题库「标签」视图的编排：列表 / 搜索 / 新建·重命名·删除。
 *
 * 与 P0 的 `use-question-groups` 同一套写法：写操作后重载列表（不做局部加减），
 * 删除走全局确认弹窗并写清影响（只解除题目标记、不删题目）。
 * 题目标签的回显与批量打标在别处：QuestionTagsEditor（单题）/ QuestionTagBatchDialog（批量）。
 */
import { ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { TagItem } from '@/api/tag';

interface ListResponse {
  tags: TagItem[];
}

export function useTags() {
  const toast = useToastStore();

  const tags = ref<TagItem[]>([]);
  const loading = ref(false);
  const search = ref('');
  const busy = ref(false);

  /** 新建 / 重命名弹窗（editingId=null 表示新建） */
  const dialogOpen = ref(false);
  const dialogEditingId = ref<number | null>(null);
  const dialogName = ref('');
  const dialogNote = ref('');
  const dialogSaving = ref(false);

  async function loadTags(): Promise<void> {
    loading.value = true;
    try {
      const query = search.value.trim() === '' ? undefined : { search: search.value.trim() };
      const res = await api.get<ListResponse>('/tags', query);
      tags.value = res.tags;
    } catch (e) {
      toast.error(errorMessage(e));
      tags.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** 搜索输入 400ms 防抖 */
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  watch(search, () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadTags(), 400);
  });

  function openCreate(): void {
    dialogEditingId.value = null;
    dialogName.value = '';
    dialogNote.value = '';
    dialogOpen.value = true;
  }

  function openRename(tag: TagItem): void {
    dialogEditingId.value = tag.id;
    dialogName.value = tag.name;
    dialogNote.value = tag.note;
    dialogOpen.value = true;
  }

  async function saveDialog(): Promise<void> {
    const name = dialogName.value.trim();
    if (name === '') {
      toast.warning('请填写标签名');
      return;
    }
    dialogSaving.value = true;
    try {
      const note = dialogNote.value;
      if (dialogEditingId.value === null) {
        await api.post('/tags', { name, note });
        toast.success(`已新建标签「${name}」`);
      } else {
        await api.put(`/tags/${dialogEditingId.value}`, { name, note });
        toast.success('已保存标签');
      }
      dialogOpen.value = false;
      await loadTags();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      dialogSaving.value = false;
    }
  }

  async function removeTag(tag: TagItem): Promise<void> {
    const detailText =
      tag.questionCount > 0
        ? `${tag.questionCount} 道题上的这个标签会被一并解除；题目本身与它的其他标签不受影响，此操作不可恢复。`
        : '这个标签还没被任何题目使用，删除后不可恢复。';
    const ok = await askConfirm({
      title: '删除标签',
      message: `确定删除标签「${tag.name}」吗？`,
      detail: detailText,
      confirmText: '删除标签',
      danger: true,
    });
    if (!ok) return;
    busy.value = true;
    try {
      await api.del(`/tags/${tag.id}`);
      toast.success(`已删除标签「${tag.name}」`);
      await loadTags();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      busy.value = false;
    }
  }

  return {
    tags,
    loading,
    search,
    busy,
    dialogOpen,
    dialogEditingId,
    dialogName,
    dialogNote,
    dialogSaving,
    loadTags,
    openCreate,
    openRename,
    saveDialog,
    removeTag,
  };
}

export type TagsApi = ReturnType<typeof useTags>;
