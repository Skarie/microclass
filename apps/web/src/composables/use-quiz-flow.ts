import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { useQuizAnswers } from '@/composables/use-quiz-answers';
import { summarizeQuiz, type QuizQuestion, type QuizSummary } from '@/utils/quiz';
import type { GradedItem } from '@/api/types';

/**
 * 单题流的共享状态：当前题、上一题/下一题、标记疑问、作答与滚动定位。
 * 课后练习、在线考试、错题本三个页面共用；取题、交卷、解析等业务留在各自的 composable。
 */
export function useQuizFlow<Q extends QuizQuestion = QuizQuestion>(
  questions: Ref<Q[]>,
  options?: { summary?: () => QuizSummary },
) {
  const currentIndex = ref(0);
  const markedIds = ref<Set<number>>(new Set());
  const answerState = useQuizAnswers(questions);

  const current = computed<Q | undefined>(() => questions.value[currentIndex.value]);
  const summary = computed<QuizSummary>(() => options?.summary?.() ?? summarizeQuiz(null, questions.value.length));

  function isMarked(qid: number): boolean {
    return markedIds.value.has(qid);
  }

  function toggleMark(qid: number): void {
    const next = new Set(markedIds.value);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    markedIds.value = next;
  }

  function clearMarks(): void {
    markedIds.value = new Set();
  }

  /** 单选/判断直接替换；多选切换。答案即时写入 answers，无需提交。 */
  function choose(value: string): void {
    const q = current.value;
    if (!q) return;
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

  // 换一组 / 换筛选结果：从第 1 题开始
  watch(questions, () => {
    currentIndex.value = 0;
  });

  return {
    currentIndex,
    current,
    summary,
    markedIds,
    isMarked,
    toggleMark,
    clearMarks,
    answers: answerState.answers,
    multipleAnswers: answerState.multipleAnswers,
    answeredIds: answerState.answeredIds,
    answeredCount: answerState.answeredCount,
    pickedOf: answerState.pickedOf,
    setAnswer: answerState.setAnswer,
    buildAnswersPayload: answerState.buildAnswersPayload,
    resetAnswers: answerState.reset,
    choose,
    goTo,
    next,
    prev,
  };
}

/**
 * 单题流页面与 QuizStage / QuizAnswerDock 之间的契约：
 * 课后练习、在线考试、错题本各自返回的对象都满足它（多出的字段页面自用）。
 */
export interface QuizFlowState {
  questions: QuizQuestion[];
  currentIndex: number;
  current: QuizQuestion | undefined;
  answers: Record<number, string>;
  pickedOf: (qid: number) => string[];
  isMarked: (qid: number) => boolean;
  toggleMark: (qid: number) => void;
  choose: (value: string) => void;
  setAnswer: (qid: number, value: string) => void;
  goTo: (index: number) => void;
  next: () => void;
  prev: () => void;
  answeredIds: Set<number>;
  answeredCount: number;
  markedIds: Set<number>;
  verdicts: Record<number, boolean | null>;
  submitting: boolean;
  /** 整卷解析模式（交卷后）：练习有，考试/错题本没有 */
  revealed: boolean;
  /** 单题解析：练习看交卷结果，错题本看「查看答案与解析」 */
  gradedOf: (qid: number) => GradedItem | null;
  summary: QuizSummary;
  submit: () => Promise<boolean>;
  unlocked: boolean;
  /** 随机题数（0 = 全部）；考试/错题本不使用 */
  count: number;
  retry?: (count?: number) => void;
  /** 错题本：已掌握的题号（答题卡绿色） */
  masteredIds?: Set<number>;
}
