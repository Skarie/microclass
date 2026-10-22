import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { ConflictGroup } from '@/composables/use-question-conflicts';

/** 组内一道题（核对弹窗表格的一行：现有答案 / 题库 / 类型 / 难度 / 来源） */
export interface ConflictQuestion {
  id: number;
  answer: string;
  type: string;
  difficulty: string;
  stem: string;
  bank_id: number;
  bank_name: string;
  bank_kind: string;
  source_no: string;
  source_path: string;
}

export interface ConflictDetailResponse {
  group: ConflictGroup;
  questions: ConflictQuestion[];
}

interface ResolveResponse {
  updated: number;
  answer: string;
}

export interface ConflictDetailDeps {
  /** 动作完成后刷新台账列表（true = 保持当前页） */
  reload: (keepPage?: boolean) => Promise<void>;
}

/**
 * 逐组核对弹窗：
 *   - 打开时拉组内题目，默认预选票数最多的答案；
 *   - 「统一为选定答案」整组统一、「忽略该组」不再提示、「恢复为待核对」打回；
 *   - 三个动作完成后都刷新列表（保持当前页）。
 */
export function useConflictDetail(deps: ConflictDetailDeps) {
  const toast = useToastStore();

  const open = ref(false);
  const loading = ref(false);
  const response = ref<ConflictDetailResponse | null>(null);
  const choice = ref('');
  const saving = ref(false);

  const group = computed(() => response.value?.group ?? null);
  const questions = computed(() => response.value?.questions ?? []);

  function close(): void {
    open.value = false;
  }

  async function openDetail(target: ConflictGroup): Promise<void> {
    open.value = true;
    loading.value = true;
    response.value = null;
    // 默认预选票数最多的答案，减少点击
    choice.value = target.answers[0]?.answer ?? '';
    try {
      const res = await api.get<ConflictDetailResponse>(`/question-conflicts/${target.contentHash}`);
      response.value = res;
      if (res.group.status === 'resolved' && res.group.chosenAnswer) choice.value = res.group.chosenAnswer;
    } catch (e) {
      toast.error(errorMessage(e));
      open.value = false;
    } finally {
      loading.value = false;
    }
  }

  async function resolve(): Promise<void> {
    const hash = response.value?.group.contentHash;
    if (!hash) return;
    if (!choice.value.trim()) {
      toast.error('请先选择或填写正确答案');
      return;
    }
    saving.value = true;
    try {
      const res = await api.post<ResolveResponse>(`/question-conflicts/${hash}/resolve`, { answer: choice.value });
      toast.success(`已统一为「${res.answer}」，共更新 ${res.updated} 道题`);
      close();
      await deps.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  async function ignore(): Promise<void> {
    const hash = response.value?.group.contentHash;
    if (!hash) return;
    saving.value = true;
    try {
      await api.post(`/question-conflicts/${hash}/ignore`);
      toast.success('已忽略该组，不再提示（题目未改动）');
      close();
      await deps.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  async function reopen(): Promise<void> {
    const hash = response.value?.group.contentHash;
    if (!hash) return;
    saving.value = true;
    try {
      await api.post(`/question-conflicts/${hash}/reopen`);
      toast.success('已恢复为待核对');
      close();
      await deps.reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      saving.value = false;
    }
  }

  return reactive({
    open,
    loading,
    group,
    questions,
    choice,
    saving,
    openDetail,
    resolve,
    ignore,
    reopen,
    close,
  });
}
