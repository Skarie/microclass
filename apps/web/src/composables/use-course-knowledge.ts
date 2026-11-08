import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { Knowledge, KnowledgePayload } from '@/api/knowledge';

/**
 * 课程级知识点（整门课共享）的数据层：列表 / 新增 / 编辑 / 删除。
 *
 * 增删改后重新拉列表；课时列表不需要刷新（课程级知识点不挂在课时下）。
 * 列表接口失败不阻塞页面其余部分，错误提示由 useAsync 统一给出。
 */
interface KnowledgeListResponse {
  knowledge: Knowledge[];
}

interface OkIdResponse {
  ok: boolean;
  id: number;
}

export interface CourseKnowledgeDeps {
  courseId: () => number;
}

export function useCourseKnowledge(deps: CourseKnowledgeDeps) {
  const toast = useToastStore();
  const { data, loading, run } = useAsync<KnowledgeListResponse>(
    () => api.get<KnowledgeListResponse>(`/courses/${deps.courseId()}/knowledge`),
    { immediate: false },
  );

  const items = computed<Knowledge[]>(() => data.value?.knowledge ?? []);
  const dialogOpen = ref(false);
  const editing = ref<Knowledge | null>(null);
  const saving = ref(false);

  async function load(): Promise<void> {
    await run();
  }

  function openCreate(): void {
    editing.value = null;
    dialogOpen.value = true;
  }

  function openEdit(item: Knowledge): void {
    editing.value = item;
    dialogOpen.value = true;
  }

  function closeDialog(): void {
    if (saving.value) return;
    dialogOpen.value = false;
  }

  async function save(payload: KnowledgePayload): Promise<void> {
    saving.value = true;
    try {
      if (editing.value) {
        await api.put<OkIdResponse>(`/knowledge/${editing.value.id}`, payload);
        toast.success(`已保存课程知识点「${payload.title}」`);
      } else {
        await api.post<OkIdResponse>(`/courses/${deps.courseId()}/knowledge`, payload);
        toast.success(`已添加课程知识点「${payload.title}」`);
      }
      dialogOpen.value = false;
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  async function remove(item: Knowledge): Promise<void> {
    const ok = await askConfirm({
      title: '删除课程知识点',
      message: `确定删除课程知识点「${item.title}」吗？`,
      detail: '删除后本课程所有课时的学生都将不再看到它，且不可恢复。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del<OkIdResponse>(`/knowledge/${item.id}`);
      toast.success(`已删除课程知识点「${item.title}」`);
      if (editing.value?.id === item.id) dialogOpen.value = false;
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return reactive({
    items,
    loading,
    dialogOpen,
    editing,
    saving,
    load,
    openCreate,
    openEdit,
    closeDialog,
    save,
    remove,
  });
}
