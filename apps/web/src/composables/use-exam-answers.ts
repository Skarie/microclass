import { computed, reactive, watch, type Ref } from 'vue';
import type { QuestionType } from '@/api/types';
import type { ExamQuestion } from '@/composables/use-exam-take';

const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

/**
 * 作答状态：单选/判断/填空/简答存字符串，多选单独存数组并同步到 answers。
 * 题型文案、填空题提示、旧版配图地址、答案提交编码也都在这里，页面与子组件只读。
 */
export function useExamAnswers(questions: Ref<ExamQuestion[]>) {
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

  function optionLabel(index: number): string {
    return String.fromCharCode(65 + index);
  }

  /** 题目加载后为多选题初始化空数组，保证绑定值类型稳定 */
  function ensureMultipleState(): void {
    for (const q of questions.value) {
      if (q.type === 'multiple' && !Array.isArray(multipleAnswers[q.id])) multipleAnswers[q.id] = [];
    }
  }
  watch(questions, ensureMultipleState, { immediate: true });

  /** 填空题输入提示：多个空时提醒按顺序用「；」分隔（与题库导入的答案编码一致） */
  function fillPlaceholder(blanks?: number): string {
    if (blanks && blanks > 1) return `共 ${blanks} 个空，请按顺序填写，用「；」分隔（如 3；-9）`;
    return '请填写答案（数学式可直接输入，如 -3/4）';
  }

  /** 旧版「题目配图」入口：题干里已有内联图片（题库导入的题）时不再重复渲染 */
  function legacyImageUrl(q: { id: number; image_path?: string; stem: string }): string {
    if (!q.image_path) return '';
    if (/!\[[^\]]*\]\(/.test(q.stem)) return '';
    return `/api/v1/question-images/${q.id}`;
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
    typeLabel: TYPE_LABEL,
    pickedOf,
    isPicked,
    toggleMultiple,
    optionLabel,
    fillPlaceholder,
    legacyImageUrl,
    buildAnswersPayload,
  };
}
