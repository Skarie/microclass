import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { ExamCompose } from '@/composables/use-exam-compose';
import type { ExamRange } from '@/composables/use-exam-range';

/**
 * 第②步「随机组卷」的表单与提交：题型数量、每题分值、可选难度配比。
 * 配比同时被第③步「保存结构并刷分值」复用，所以放在这里由页面共享。
 */
export function useExamRandom({ compose, range }: { compose: ExamCompose; range: ExamRange }) {
  const toast = useToastStore();
  const quotaForm = reactive<Record<string, number>>({ single: 0, multiple: 0, judge: 0, fill: 0, short: 0 });
  const scoreForm = reactive<Record<string, number>>({
    single: 5,
    multiple: 5,
    judge: 2,
    fill: 2,
    short: 6,
  });
  const targetRatio = reactive({ easy: 30, medium: 50, hard: 20 });
  const useRatio = ref(false);

  async function runRandomCompose(): Promise<void> {
    const quota = Object.fromEntries(Object.entries(quotaForm).filter(([, n]) => Number(n) > 0));
    if (Object.keys(quota).length === 0) {
      toast.warning('请至少填一种题型的数量');
      return;
    }
    compose.busy = true;
    try {
      const sum = targetRatio.easy + targetRatio.medium + targetRatio.hard;
      const scores = Object.fromEntries(
        Object.entries(scoreForm).filter(([t, n]) => Number(quota[t]) > 0 && Number(n) > 0),
      );
      const res = await api.post<{ added: number; shortfall: number }>(`/exams/${compose.examId}/compose`, {
        quota,
        scores,
        replaceExisting: true,
        scope: range.scope,
        ...(range.selected.books.length > 0 ? { books: range.selected.books } : {}),
        ...(range.selected.chapters.length > 0 ? { chapters: range.selected.chapters } : {}),
        ...(range.selected.points.length > 0 ? { points: range.selected.points } : {}),
        ...(useRatio.value && sum > 0
          ? {
              ratio: {
                easy: targetRatio.easy / sum,
                medium: targetRatio.medium / sum,
                hard: targetRatio.hard / sum,
              },
            }
          : {}),
      });
      if (res.shortfall > 0) toast.warning(`按范围抽到 ${res.added} 题，缺口 ${res.shortfall} 题（范围内题量不够）`);
      else toast.success(`已按范围随机生成 ${res.added} 题`);
      await Promise.all([compose.loadPaper(), compose.loadExam()]);
      compose.step = 3;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      compose.busy = false;
    }
  }

  return reactive({ quotaForm, scoreForm, targetRatio, useRatio, runRandomCompose });
}

export type ExamRandom = ReturnType<typeof useExamRandom>;
