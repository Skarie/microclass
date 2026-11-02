import { computed, reactive, watch, type Ref } from 'vue';
import type { QuizQuestion } from '@/utils/quiz';

/**
 * 刷题作答状态：单选/判断/填空/简答存字符串，多选单独存数组并同步到 answers。
 * 答案编码与拆分前逐字一致（单选/多选传下标串、判断 T/F、填空/简答原样）。
 */
export function useQuizAnswers(questions: Ref<QuizQuestion[]>) {
  const answers = reactive<Record<number, string>>({});
  const multipleAnswers = reactive<Record<number, string[]>>({});

  /** 多选题已选项：始终返回数组，避免绑定值被写成字符串/false 后渲染抛错 */
  function pickedOf(qid: number): string[] {
    const value = multipleAnswers[qid];
    return Array.isArray(value) ? value : [];
  }

  function isPicked(qid: number, value: string): boolean {
    return pickedOf(qid).includes(value);
  }

  /** 显式受控的多选切换：不依赖 v-model 在「非数组模型」下的兜底行为 */
  function toggleMultiple(qid: number, value: string): void {
    const next = new Set(pickedOf(qid));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    multipleAnswers[qid] = [...next].sort((a, b) => Number(a) - Number(b));
    answers[qid] = multipleAnswers[qid].join(',');
  }

  function setAnswer(qid: number, value: string): void {
    answers[qid] = value;
  }

  const answeredIds = computed<Set<number>>(() => {
    const set = new Set<number>();
    for (const q of questions.value) {
      if (q.type === 'multiple') {
        if (pickedOf(q.id).length > 0) set.add(q.id);
      } else if ((answers[q.id] ?? '').trim() !== '') {
        set.add(q.id);
      }
    }
    return set;
  });
  const answeredCount = computed(() => answeredIds.value.size);

  /** 题目加载后为多选题初始化空数组，保证绑定值类型稳定 */
  function ensureMultipleState(): void {
    for (const q of questions.value) {
      if (q.type === 'multiple' && !Array.isArray(multipleAnswers[q.id])) multipleAnswers[q.id] = [];
    }
  }
  watch(questions, ensureMultipleState, { immediate: true });

  /** 换一组 / 切课时：清空全部作答（与拆分前的 delete 行为一致） */
  function reset(): void {
    for (const key of Object.keys(answers)) delete answers[Number(key)];
    for (const key of Object.keys(multipleAnswers)) delete multipleAnswers[Number(key)];
  }

  /** 交卷答案编码（单选/多选传下标、判断 T/F、填空/简答原样），与拆分前逐字一致 */
  function buildAnswersPayload(): { qid: number; answer: string }[] {
    return questions.value.map((q) => ({
      qid: q.id,
      answer:
        q.type === 'multiple'
          ? [...pickedOf(q.id)].sort((a, b) => Number(a) - Number(b)).join(',')
          : (answers[q.id] ?? ''),
    }));
  }

  return {
    answers,
    multipleAnswers,
    answeredIds,
    answeredCount,
    pickedOf,
    isPicked,
    toggleMultiple,
    setAnswer,
    reset,
    buildAnswersPayload,
  };
}
