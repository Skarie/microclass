import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useQuizAnswers } from '@/composables/use-quiz-answers';
import { useToastStore } from '@/stores/toast';
import { summarizeQuiz } from '@/utils/quiz';
import type { QuestionView, QuizSubmitResult } from '@/api/types';

export interface QuizResponse {
  lesson: { id: number; title: string };
  questions: QuestionView[];
  total: number;
  mode: string;
  unlocked: boolean;
}

/**
 * 刷题会话：取题 `GET /lessons/:id/quiz`、交卷 `POST /lessons/:id/quiz/submit`
 * （请求体与拆分前逐字一致）、当前题、标记疑问、结果统计与换一组。
 * 作答状态在 use-quiz-answers，键盘在 use-quiz-hotkeys。
 */
export function useQuizSession() {
  const route = useRoute();
  const toast = useToastStore();
  const lessonId = computed(() => Number(route.params.id));
  const count = ref(0);
  const currentIndex = ref(0);
  const markedIds = ref<Set<number>>(new Set());
  const result = ref<QuizSubmitResult | null>(null);
  const submitting = ref(false);

  const { data, loading, run } = useAsync<QuizResponse>(() =>
    api.get<QuizResponse>(`/lessons/${lessonId.value}/quiz`, count.value > 0 ? { count: count.value } : undefined),
  );

  const questions = computed<QuestionView[]>(() => data.value?.questions ?? []);
  const answerState = useQuizAnswers(questions);
  const lesson = computed(() => data.value?.lesson ?? null);
  const unlocked = computed(() => data.value?.unlocked ?? false);
  const mode = computed(() => data.value?.mode ?? 'all');

  const current = computed<QuestionView | undefined>(() => questions.value[currentIndex.value]);
  const resultMap = computed(() => new Map((result.value?.results ?? []).map((r) => [r.qid, r])));
  const verdicts = computed<Record<number, boolean | null>>(() => {
    const out: Record<number, boolean | null> = {};
    for (const r of result.value?.results ?? []) out[r.qid] = r.correct;
    return out;
  });
  const summary = computed(() => summarizeQuiz(result.value, questions.value.length));

  function isMarked(qid: number): boolean {
    return markedIds.value.has(qid);
  }

  function toggleMark(qid: number): void {
    const next = new Set(markedIds.value);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    markedIds.value = next;
  }

  /** 单选/判断直接替换；多选切换。答案即时写入 answers，无需提交。 */
  function choose(value: string): void {
    const q = current.value;
    if (!q || result.value) return;
    if (q.type === 'multiple') answerState.toggleMultiple(q.id, value);
    else answerState.setAnswer(q.id, value);
  }

  function goTo(index: number): void {
    if (questions.value.length === 0) return;
    currentIndex.value = Math.min(Math.max(0, index), questions.value.length - 1);
    void nextTick(() => {
      document.getElementById('quiz-question')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function next(): void {
    goTo(currentIndex.value + 1);
  }

  function prev(): void {
    goTo(currentIndex.value - 1);
  }

  /** 交卷：未答先确认；成功后进入解析模式并从第 1 题查看 */
  async function submit(): Promise<boolean> {
    if (submitting.value) return false;
    if (answerState.answeredCount.value === 0) {
      toast.warning('请至少作答一题');
      return false;
    }
    const missing = questions.value.length - answerState.answeredCount.value;
    if (missing > 0 && !window.confirm(`还有 ${missing} 题未作答，确定交卷吗？`)) return false;
    submitting.value = true;
    try {
      const payload = { answers: answerState.buildAnswersPayload() };
      result.value = await api.post<QuizSubmitResult>(`/lessons/${lessonId.value}/quiz/submit`, payload);
      toast.success(`本次得分 ${result.value.score}/${result.value.total}`);
      currentIndex.value = 0;
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
    answerState.reset();
    markedIds.value = new Set();
    currentIndex.value = 0;
    count.value = randomCount;
    void run();
  }

  watch(questions, () => {
    currentIndex.value = 0;
  });
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
    currentIndex,
    current,
    answers: answerState.answers,
    multipleAnswers: answerState.multipleAnswers,
    answeredIds: answerState.answeredIds,
    answeredCount: answerState.answeredCount,
    pickedOf: answerState.pickedOf,
    isPicked: answerState.isPicked,
    setAnswer: answerState.setAnswer,
    buildAnswersPayload: answerState.buildAnswersPayload,
    result,
    resultMap,
    verdicts,
    summary,
    submitting,
    markedIds,
    isMarked,
    toggleMark,
    choose,
    goTo,
    next,
    prev,
    submit,
    retry,
  });
}
