import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { ExamCompose } from '@/composables/use-exam-compose';

/** 平行组卷（A/B 卷）：入口在第②步，生成后跳到新考试的组卷页并落在第③步。 */
export function useExamParallel({ compose }: { compose: ExamCompose }) {
  const router = useRouter();
  const toast = useToastStore();
  const parallelOpen = ref(false);
  const parallelBusy = ref(false);
  const parallelForm = reactive({ title: '', scope: 'course' });

  async function runParallel(): Promise<void> {
    parallelBusy.value = true;
    try {
      const res = await api.post<{
        examId: number;
        title: string;
        matched: number;
        requested: number;
        shortfall: number;
      }>(`/exams/${compose.examId}/parallel`, {
        ...(parallelForm.title.trim() !== '' ? { title: parallelForm.title.trim() } : {}),
        scope: parallelForm.scope,
      });
      if (res.shortfall > 0)
        toast.warning(`平行卷已生成：配到 ${res.matched}/${res.requested} 题，缺口 ${res.shortfall} 题`);
      else toast.success(`平行卷已生成（${res.matched} 题）：${res.title}`);
      parallelOpen.value = false;
      compose.landOnPaper = true;
      await router.push(`/admin/exams/${res.examId}/compose`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      parallelBusy.value = false;
    }
  }

  return reactive({ parallelOpen, parallelBusy, parallelForm, runParallel });
}

export type ExamParallel = ReturnType<typeof useExamParallel>;
