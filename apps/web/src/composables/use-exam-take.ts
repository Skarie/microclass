import { computed, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useExamCountdown } from '@/composables/use-exam-countdown';
import { useQuizFlow } from '@/composables/use-quiz-flow';
import { useToastStore } from '@/stores/toast';
import type { QuizQuestion } from '@/utils/quiz';
import type { ExamSubmitResult } from '@/api/types';

export interface ExamQuestion extends QuizQuestion {
  sort: number;
}

export interface ExamTakeResponse {
  already: boolean;
  exam: {
    id: number;
    title: string;
    description?: string;
    duration_minutes?: number;
    pass_score?: number;
  };
  questions?: ExamQuestion[];
  total?: number;
}

/**
 * 在线考试作答页的数据与动作（页面只做编排）：
 *  - 取卷 `GET /exams/:id/take`、交卷 `POST /exams/:id/submit`（参数与拆分前逐字一致）
 *  - 单题导航/作答/标记在 use-quiz-flow，倒计时与自动交卷在 use-exam-countdown
 *  - 答案编码与后端一致：单选/多选传选项下标（多选逗号升序），判断传 T/F
 */
export function useExamTake() {
  const route = useRoute();
  const router = useRouter();
  const toast = useToastStore();
  const examId = computed(() => Number(route.params.id));

  const submitting = ref(false);
  const submitted = ref(false);

  // 到点自动交卷；submit 是函数声明，计时器触发时已初始化
  const countdown = useExamCountdown(() => void submit(true));

  const { data, loading, run } = useAsync<ExamTakeResponse>(async () => {
    const res = await api.get<ExamTakeResponse>(`/exams/${examId.value}/take`);
    if (!res.already) countdown.start(res.exam.duration_minutes);
    return res;
  });

  const questions = computed<QuizQuestion[]>(() => data.value?.questions ?? []);
  const flow = useQuizFlow(questions);

  async function submit(auto = false): Promise<boolean> {
    if (submitting.value || submitted.value) return false;
    const list = questions.value;
    if (list.length === 0) {
      toast.error('本场考试还没有题目');
      return false;
    }
    if (!auto) {
      const missing = list.length - flow.answeredCount.value;
      const ok = await askConfirm({
        title: '交卷确认',
        message: missing > 0 ? `还有 ${missing} 题未作答，确定要交卷吗？` : '确定要交卷吗？',
        detail: '交卷后不能修改答案；未作答的题目按错误计入成绩。',
        confirmText: '交卷',
      });
      if (!ok) return false;
    }

    submitting.value = true;
    try {
      const payload = {
        answers: flow.buildAnswersPayload(),
        startedAt: countdown.startedAt.value,
      };
      await api.post<ExamSubmitResult>(`/exams/${examId.value}/submit`, payload);
      submitted.value = true;
      countdown.stop();
      toast.success('交卷成功，正在生成成绩…');
      await router.push({ name: 'exam-result', params: { id: examId.value } });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      submitting.value = false;
    }
  }

  onBeforeRouteLeave(async () => {
    if (!data.value || data.value.already || submitted.value) return true;
    if (questions.value.length > 0 && flow.answeredCount.value === questions.value.length) return true;
    return askConfirm({
      title: '离开考试',
      message: '试卷尚未提交，离开将丢失本次作答。',
      detail: '已作答内容不会保存；可以留在本页交卷后再离开。',
      confirmText: '离开考试',
      danger: true,
    });
  });

  return reactive({
    data,
    loading,
    run,
    examId,
    questions,
    currentIndex: flow.currentIndex,
    current: flow.current,
    answers: flow.answers,
    multipleAnswers: flow.multipleAnswers,
    answeredIds: flow.answeredIds,
    answeredCount: flow.answeredCount,
    pickedOf: flow.pickedOf,
    setAnswer: flow.setAnswer,
    buildAnswersPayload: flow.buildAnswersPayload,
    isMarked: flow.isMarked,
    toggleMark: flow.toggleMark,
    markedIds: flow.markedIds,
    choose: flow.choose,
    goTo: flow.goTo,
    next: flow.next,
    prev: flow.prev,
    verdicts: computed<Record<number, boolean | null>>(() => ({})),
    revealed: false,
    gradedOf: (): null => null,
    summary: flow.summary,
    count: 0,
    unlocked: true,
    submitting,
    submitted,
    submit,
    limitSeconds: countdown.limitSeconds,
    remaining: countdown.remaining,
    startedAt: countdown.startedAt,
    formatClock: countdown.formatClock,
  });
}
