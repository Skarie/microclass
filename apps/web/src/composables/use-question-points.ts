/**
 * 题库内「知识点」多选筛选：与标签共用同一套 any / all 语义。
 *
 * 为什么知识点要做成多选：一道题的知识点字段可能写多个（「二次函数;一次函数」），
 * 老师常常想找「同时涉及这两点」的题（all），而不只是「任意一个」（any）。
 *
 * 后端没有「某题库有哪些知识点」的接口，候选从已加载的题目里汇总（与章节/小节筛选同一套路），
 * 所以 `mergeQuestions` 要在每次列表加载后调用。
 */
import { computed, ref } from 'vue';

/** 知识点串里的分隔符：导入的题目可能用分号/逗号/顿号分隔多个知识点 */
const SPLIT_RE = /[;；,，、]/;

export function useQuestionPoints(onFilterChange: () => void) {
  const pointFilter = ref<string[]>([]);
  const pointMode = ref<'any' | 'all'>('any');
  /** 候选知识点（从题目里汇总，按出现顺序） */
  const pointOptions = ref<string[]>([]);

  const hasPointFilter = computed(() => pointFilter.value.length > 0);
  const pointFilterValues = computed(() => pointFilter.value);
  const pointFilterOptions = computed(() => pointOptions.value.map((point) => ({ value: point, label: point })));

  /** 把题目里的知识点拆开补进候选 */
  function mergeQuestions(questions: { point?: string }[]): void {
    const seen = new Set(pointOptions.value);
    const next = [...pointOptions.value];
    for (const question of questions) {
      for (const part of String(question.point ?? '').split(SPLIT_RE)) {
        const point = part.trim();
        if (point === '' || seen.has(point)) continue;
        seen.add(point);
        next.push(point);
      }
    }
    if (next.length !== pointOptions.value.length) pointOptions.value = next;
  }

  function resetPoints(): void {
    pointFilter.value = [];
    pointMode.value = 'any';
    pointOptions.value = [];
  }

  function setPointFilterValues(values: string[]): void {
    pointFilter.value = values.filter((value) => value.trim() !== '');
    onFilterChange();
  }

  function setPointMode(mode: 'any' | 'all'): void {
    if (pointMode.value === mode) return;
    pointMode.value = mode;
    if (hasPointFilter.value) onFilterChange();
  }

  /** 把筛选写进查询串（重复参数：`points=A&points=B`） */
  function applyTo(params: URLSearchParams): void {
    if (!hasPointFilter.value) return;
    for (const point of pointFilter.value) params.append('points', point);
    params.set('pointMode', pointMode.value);
  }

  return {
    pointFilter,
    pointMode,
    pointOptions,
    pointFilterValues,
    pointFilterOptions,
    hasPointFilter,
    mergeQuestions,
    resetPoints,
    setPointFilterValues,
    setPointMode,
    applyTo,
  };
}

export type QuestionPointsFilterApi = ReturnType<typeof useQuestionPoints>;
