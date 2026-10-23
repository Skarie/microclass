import { computed, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useExamAnswers } from '@/composables/use-exam-answers';
import { useExamCountdown } from '@/composables/use-exam-countdown';
import { useToastStore } from '@/stores/toast';
import type { ExamSubmitResult, QuestionType } from '@/api/types';

export interface ExamQuestion {
  id: number;
  type: QuestionType;
  stem: string;
  image_path: string;
  options: string[];
  sort: number;
  /** 填空题空位数（>1 时按顺序用「；」分隔作答） */
  blanks?: number;
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
 *  - 答案暂存（本页无 localStorage，纯内存）、答题进度、切题滚动
 *  - 倒计时 / 自动交卷在 use-exam-countdown，答案编码在 use-exam-answers
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

  const questions = computed<ExamQuestion[]>(() => data.value?.questions ?? []);
  const answerState = useExamAnswers(questions);

  async function submit(auto = false): Promise<void> {
    if (submitting.value || submitted.value) return;
    const list = questions.value;
    if (list.length === 0) {
      toast.error('本场考试还没有题目');
      return;
    }
    if (!auto) {
      const missing = list.length - answerState.answeredCount.value;
      const tip = missing > 0 ? `还有 ${missing} 题未作答，确定要交卷吗？` : '确定要交卷吗？交卷后不能修改。';
      if (!window.confirm(tip)) return;
    }

    submitting.value = true;
    try {
      const payload = {
        answers: answerState.buildAnswersPayload(),
        startedAt: countdown.startedAt.value,
      };
      await api.post<ExamSubmitResult>(`/exams/${examId.value}/submit`, payload);
      submitted.value = true;
      countdown.stop();
      toast.success('交卷成功，正在生成成绩…');
      await router.push({ name: 'exam-result', params: { id: examId.value } });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      submitting.value = false;
    }
  }

  onBeforeRouteLeave(() => {
    if (!data.value || data.value.already || submitted.value) return true;
    if (questions.value.length > 0 && answerState.answeredCount.value === questions.value.length) return true;
    return window.confirm('试卷尚未提交，离开将丢失本次作答，确定离开吗？');
  });

  return reactive({
    data,
    loading,
    run,
    examId,
    questions,
    submitting,
    submitted,
    answers: answerState.answers,
    multipleAnswers: answerState.multipleAnswers,
    answeredIds: answerState.answeredIds,
    answeredCount: answerState.answeredCount,
    typeLabel: answerState.typeLabel,
    pickedOf: answerState.pickedOf,
    isPicked: answerState.isPicked,
    toggleMultiple: answerState.toggleMultiple,
    optionLabel: answerState.optionLabel,
    fillPlaceholder: answerState.fillPlaceholder,
    legacyImageUrl: answerState.legacyImageUrl,
    buildAnswersPayload: answerState.buildAnswersPayload,
    limitSeconds: countdown.limitSeconds,
    remaining: countdown.remaining,
    startedAt: countdown.startedAt,
    formatClock: countdown.formatClock,
    submit,
  });
}
