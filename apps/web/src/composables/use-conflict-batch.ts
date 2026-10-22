import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';

export interface MajorityResponse {
  groups: number;
  questions: number;
  skipped: number;
  dryRun: boolean;
  samples: { stem: string; answer: string; n: number }[];
}

export interface EquivalentResponse {
  groups: number;
  questions: number;
  skipped: number;
  dryRun: boolean;
  samples: { stem: string; from: string[]; merged: string }[];
}

export interface ConflictBatchDeps {
  /** 批量处理完刷新台账列表（回到第 1 页） */
  reload: () => Promise<void>;
}

/**
 * 两个批量入口，都是「先预演、确认后才落库」：
 *   - 按多数答案：每组采用出现次数最多的答案；票数并列的不猜，留给人工；
 *   - 合并同义写法：数学等价的写法合并成「A|B」，两种写法都算对。
 */
export function useConflictBatch(deps: ConflictBatchDeps) {
  const toast = useToastStore();

  const majorityOpen = ref(false);
  const majorityLoading = ref(false);
  const majorityPreview = ref<MajorityResponse | null>(null);

  const equivOpen = ref(false);
  const equivLoading = ref(false);
  const equivPreview = ref<EquivalentResponse | null>(null);

  async function previewMajority(): Promise<void> {
    majorityOpen.value = true;
    majorityLoading.value = true;
    majorityPreview.value = null;
    try {
      majorityPreview.value = await api.post<MajorityResponse>('/question-conflicts/resolve-majority');
    } catch (e) {
      toast.error(errorMessage(e));
      majorityOpen.value = false;
    } finally {
      majorityLoading.value = false;
    }
  }

  async function applyMajority(): Promise<void> {
    majorityLoading.value = true;
    try {
      const res = await api.post<MajorityResponse>('/question-conflicts/resolve-majority?dryRun=0');
      toast.success(`已按多数答案处理 ${res.groups} 组（${res.questions} 题），跳过并列 ${res.skipped} 组`);
      closeMajority();
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      majorityLoading.value = false;
    }
  }

  function closeMajority(): void {
    majorityOpen.value = false;
  }

  async function previewEquivalent(): Promise<void> {
    equivOpen.value = true;
    equivLoading.value = true;
    equivPreview.value = null;
    try {
      equivPreview.value = await api.post<EquivalentResponse>('/question-conflicts/resolve-equivalent');
    } catch (e) {
      toast.error(errorMessage(e));
      equivOpen.value = false;
    } finally {
      equivLoading.value = false;
    }
  }

  async function applyEquivalent(): Promise<void> {
    equivLoading.value = true;
    try {
      const res = await api.post<EquivalentResponse>('/question-conflicts/resolve-equivalent?dryRun=0');
      toast.success(`已合并 ${res.groups} 组同义写法（${res.questions} 题），其余 ${res.skipped} 组留给人工`);
      closeEquiv();
      await deps.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      equivLoading.value = false;
    }
  }

  function closeEquiv(): void {
    equivOpen.value = false;
  }

  return reactive({
    majorityOpen,
    majorityLoading,
    majorityPreview,
    previewMajority,
    applyMajority,
    closeMajority,
    equivOpen,
    equivLoading,
    equivPreview,
    previewEquivalent,
    applyEquivalent,
    closeEquiv,
  });
}
