/**
 * 题库「题组」视图的编排：列表 / 搜索 / 详情 / 新建·重命名·删除 / 移出题目。
 *
 * 数据形状见 `api/question-group.ts`；写入后统一「重载列表 + 重载当前详情」，
 * 保证列表上的计数与详情里的题目永远同源（不做局部加一减一，省掉一类不一致 bug）。
 * 删除走全局确认弹窗，正文写清「只解除关联、不删题目」。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { QuestionGroupDetail, QuestionGroupRole, QuestionGroupSummary } from '@/api/question-group';

interface ListResponse {
  groups: QuestionGroupSummary[];
}

export function useQuestionGroups() {
  const toast = useToastStore();

  const groups = ref<QuestionGroupSummary[]>([]);
  const listLoading = ref(false);
  const search = ref('');
  const selectedId = ref<number | null>(null);
  const detail = ref<QuestionGroupDetail | null>(null);
  const detailLoading = ref(false);
  const busy = ref(false);

  /** 新建 / 重命名弹窗（同一个表单，editingId=null 表示新建） */
  const dialogOpen = ref(false);
  const dialogEditingId = ref<number | null>(null);
  const dialogTitle = ref('');
  const dialogNote = ref('');
  const dialogSaving = ref(false);

  const selectedSummary = computed(() => groups.value.find((g) => g.id === selectedId.value) ?? null);

  async function loadGroups(): Promise<void> {
    listLoading.value = true;
    try {
      const query = search.value.trim() === '' ? undefined : { search: search.value.trim() };
      const res = await api.get<ListResponse>('/question-groups', query);
      groups.value = res.groups;
      // 选中的组被删掉 / 搜索后不在列表里：清掉右侧详情，避免挂着旧数据
      if (selectedId.value !== null && !res.groups.some((g) => g.id === selectedId.value)) {
        selectedId.value = null;
        detail.value = null;
      }
    } catch (e) {
      toast.error(errorMessage(e));
      groups.value = [];
    } finally {
      listLoading.value = false;
    }
  }

  async function loadDetail(id: number): Promise<void> {
    detailLoading.value = true;
    try {
      detail.value = await api.get<QuestionGroupDetail>(`/question-groups/${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      detail.value = null;
    } finally {
      detailLoading.value = false;
    }
  }

  async function selectGroup(id: number): Promise<void> {
    if (selectedId.value === id) return;
    selectedId.value = id;
    await loadDetail(id);
  }

  /** 搜索输入 400ms 防抖（与题库页关键词搜索同一手感） */
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  watch(search, () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadGroups(), 400);
  });

  function openCreate(): void {
    dialogEditingId.value = null;
    dialogTitle.value = '';
    dialogNote.value = '';
    dialogOpen.value = true;
  }

  function openRename(group: QuestionGroupSummary): void {
    dialogEditingId.value = group.id;
    dialogTitle.value = group.title;
    dialogNote.value = group.note;
    dialogOpen.value = true;
  }

  async function saveDialog(): Promise<void> {
    const title = dialogTitle.value.trim();
    if (title === '') {
      toast.warning('请填写题组标题');
      return;
    }
    dialogSaving.value = true;
    try {
      const note = dialogNote.value;
      if (dialogEditingId.value === null) {
        const res = await api.post<{ ok: boolean; id: number }>('/question-groups', { title, note });
        toast.success(`已新建题组「${title}」`);
        dialogOpen.value = false;
        await loadGroups();
        await selectGroup(res.id);
      } else {
        await api.put(`/question-groups/${dialogEditingId.value}`, { title, note });
        toast.success('已保存题组信息');
        dialogOpen.value = false;
        await loadGroups();
        if (selectedId.value === dialogEditingId.value) await loadDetail(dialogEditingId.value);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      dialogSaving.value = false;
    }
  }

  async function removeGroup(group: QuestionGroupSummary): Promise<void> {
    const detailText =
      group.total > 0
        ? `组内 ${group.total} 道题只是解除与本题组的关联，题目本身和它在题库里的位置都不变。`
        : '这个题组里还没有题目，删除后无法恢复。';
    const ok = await askConfirm({
      title: '删除题组',
      message: `确定删除题组「${group.title}」吗？`,
      detail: detailText,
      confirmText: '删除题组',
      danger: true,
    });
    if (!ok) return;
    busy.value = true;
    try {
      await api.del(`/question-groups/${group.id}`);
      toast.success(`已删除题组「${group.title}」`);
      if (selectedId.value === group.id) {
        selectedId.value = null;
        detail.value = null;
      }
      await loadGroups();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      busy.value = false;
    }
  }

  async function removeItem(questionId: number): Promise<void> {
    const id = selectedId.value;
    if (id === null) return;
    busy.value = true;
    try {
      await api.del(`/question-groups/${id}/items/${questionId}`);
      toast.success('已移出题组');
      await Promise.all([loadDetail(id), loadGroups()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      busy.value = false;
    }
  }

  /** 加入 / 改角色：整组加入与详情里的「设为母题」共用一个接口 */
  async function addItems(questionIds: number[], role: QuestionGroupRole): Promise<boolean> {
    const id = selectedId.value;
    if (id === null || questionIds.length === 0) return false;
    busy.value = true;
    try {
      const res = await api.post<{ added: number; updated: number; total: number }>(`/question-groups/${id}/items`, {
        questionIds,
        role,
      });
      toast.success(res.added > 0 ? `已加入 ${res.added} 道题` : `已更新 ${res.updated} 道题的角色`);
      await Promise.all([loadDetail(id), loadGroups()]);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    groups,
    listLoading,
    search,
    selectedId,
    detail,
    detailLoading,
    busy,
    selectedSummary,
    dialogOpen,
    dialogEditingId,
    dialogTitle,
    dialogNote,
    dialogSaving,
    loadGroups,
    loadDetail,
    selectGroup,
    openCreate,
    openRename,
    saveDialog,
    removeGroup,
    removeItem,
    addItems,
  };
}

export type QuestionGroupsApi = ReturnType<typeof useQuestionGroups>;
