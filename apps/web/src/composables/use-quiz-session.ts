import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useQuizFlow } from '@/composables/use-quiz-flow';
import { useToastStore } from '@/stores/toast';
import { sortQuestionsByType, summarizeQuiz } from '@/utils/quiz';
import type { GradedItem, QuestionView, QuizSubmitResult } from '@/api/types';

export interface QuizResponse {
  lesson: { id: number; title: string };
  questions: QuestionView[];
  total: number;
  mode: string;
  unlocked: boolean;
}

/**
 * 刷题会话：取题 `GET /lessons/:id/quiz`、交卷 `POST /lessons/:id/quiz/submit`
 * （请求体与拆分前逐字一致）、结果统计与换一组。
 * 单题导航/标记/作答在 use-quiz-flow，键盘在 use-quiz-hotkeys。
 */
export function useQuizSession() {
  const route = useRoute();
  const toast = useToastStore();
  const lessonId = computed(() => Number(route.params.id));
  const count = ref(0);
  const result = ref<QuizSubmitResult | null>(null);
  const submitting = ref(false);

  const { data, loading, run } = useAsync<QuizResponse>(() =>
    api.get<QuizResponse>(`/lessons/${lessonId.value}/quiz`, count.value > 0 ? { count: count.value } : undefined),
  );

  // 按题型稳定排序：题号连续，答题卡的题型分组区间才有意义
  const questions = computed<QuestionView[]>(() => sortQuestionsByType(data.value?.questions ?? []));
  const flow = useQuizFlow(questions, { summary: () => summarizeQuiz(result.value, questions.value.length) });
  const lesson = computed(() => data.value?.lesson ?? null);
  const unlocked = computed(() => data.value?.unlocked ?? false);
  const mode = computed(() => data.value?.mode ?? 'all');

  const resultMap = computed(() => new Map((result.value?.results ?? []).map((r) => [r.qid, r])));
  const revealed = computed(() => Boolean(result.value));
  const verdicts = computed<Record<number, boolean | null>>(() => {
    const out: Record<number, boolean | null> = {};
    for (const r of result.value?.results ?? []) out[r.qid] = r.correct;
    return out;
  });

  function gradedOf(qid: number): GradedItem | null {
    return resultMap.value.get(qid) ?? null;
  }

  function choose(value: string): void {
    if (result.value) return;
    flow.choose(value);
  }

  /** 交卷：未答先确认；成功后进入解析模式并从第 1 题查看 */
  async function submit(): Promise<boolean> {
    if (submitting.value) return false;
    if (flow.answeredCount.value === 0) {
      toast.warning('请至少作答一题');
      return false;
    }
    const missing = questions.value.length - flow.answeredCount.value;
    if (missing > 0) {
      const ok = await askConfirm({
        title: '交卷确认',
        message: `还有 ${missing} 题未作答，确定交卷吗？`,
        detail: '交卷后不能修改答案；未作答的题目按错误计入结果。',
        confirmText: '交卷',
      });
      if (!ok) return false;
    }
    submitting.value = true;
    try {
      const payload = { answers: flow.buildAnswersPayload() };
      result.value = await api.post<QuizSubmitResult>(`/lessons/${lessonId.value}/quiz/submit`, payload);
      toast.success(`本次得分 ${result.value.score}/${result.value.total}`);
      flow.currentIndex.value = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      submitting.value = false;
    }
  }

  /** 换一组（随机题数 0 = 全部）：恢复练习模式并重新取题 */
  function retry(randomCount = 0): void {
    result.value = null;
    flow.resetAnswers();
    flow.clearMarks();
    flow.currentIndex.value = 0;
    count.value = randomCount;
    void run();
  }

  watch(lessonId, () => retry(0));

  return reactive({
    data,
    loading,
    lessonId,
    lesson,
    questions,
    count,
    mode,
    unlocked,
    currentIndex: flow.currentIndex,
    current: flow.current,
    answers: flow.answers,
    multipleAnswers: flow.multipleAnswers,
    answeredIds: flow.answeredIds,
    answeredCount: flow.answeredCount,
    pickedOf: flow.pickedOf,
    setAnswer: flow.setAnswer,
    buildAnswersPayload: flow.buildAnswersPayload,
    result,
    resultMap,
    verdicts,
    summary: flow.summary,
    submitting,
    markedIds: flow.markedIds,
    isMarked: flow.isMarked,
    toggleMark: flow.toggleMark,
    choose,
    goTo: flow.goTo,
    next: flow.next,
    prev: flow.prev,
    revealed,
    gradedOf,
    submit,
    retry,
  });
}
