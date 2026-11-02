import { QUIZ_TYPE_LABEL, type QuizQuestion } from '../../utils/quiz';
import type { QuestionType } from '../../api/types';

export interface QuizQuestionGroup {
  type: QuestionType;
  label: string;
  /** 组内题号连续时显示范围（如 1-10）；打乱后不连续则为空，避免“1-17 只有 4 题”的误导 */
  range: string;
  items: { q: QuizQuestion; index: number }[];
}

/**
 * 答题卡分组：按题型首次出现的顺序分组，组内保持原题号顺序。
 * 抽成纯函数便于单测，也避免答题卡组件的脚本过长。
 */
export function groupQuestionsByType(questions: QuizQuestion[]): QuizQuestionGroup[] {
  const order: QuestionType[] = [];
  const map = new Map<QuestionType, { q: QuizQuestion; index: number }[]>();
  questions.forEach((q, index) => {
    if (!map.has(q.type)) {
      order.push(q.type);
      map.set(q.type, []);
    }
    map.get(q.type)?.push({ q, index });
  });
  return order.map((type) => {
    const items = map.get(type) ?? [];
    const numbers = items.map((item) => item.index + 1);
    const contiguous = numbers.every((n, i) => i === 0 || n === (numbers[i - 1] ?? 0) + 1);
    const first = numbers[0] ?? 0;
    const last = numbers[numbers.length - 1] ?? 0;
    return {
      type,
      label: QUIZ_TYPE_LABEL[type],
      range: contiguous ? (first === last ? String(first) : `${first}-${last}`) : '',
      items,
    };
  });
}
