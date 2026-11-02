import type { QuestionType, QuizSubmitResult } from '@/api/types';

/**
 * 刷题页的纯函数：选项编码、填空拆分、结果统计。
 * 页面与子组件只读这些函数，测试直接覆盖边界（不依赖组件挂载）。
 */
export const QUIZ_TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 后端保存的是选项下标串（"0,2"）；解析成升序下标数组 */
export function optionIndices(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
}

/** 下标串 → 选项字母串（"0,2" → "AC"） */
export function lettersOf(raw: string | undefined): string {
  return optionIndices(raw)
    .map((i) => optionLetter(i))
    .join('');
}

/** 判断题答案 → 中文；未知值返回空串 */
export function judgeText(raw: string | undefined): string {
  if (raw === 'T') return '对';
  if (raw === 'F') return '错';
  return '';
}

/** 多空填空：把「；」分隔的答案拆成固定数量的输入框（不足补空，不丢已输入内容） */
export function splitBlankAnswers(raw: string, blanks: number): string[] {
  const parts = raw.split(/[；;]/);
  const size = Math.max(1, blanks, parts.length);
  return Array.from({ length: size }, (_, i) => parts[i] ?? '');
}

/** 多空填空提交编码：与题库导入一致，按顺序用「；」拼接 */
export function joinBlankAnswers(parts: string[]): string {
  return parts.join('；');
}

/** 填空题输入提示（与拆分前文案一致） */
export function fillPlaceholder(blanks?: number): string {
  if (blanks && blanks > 1) return `共 ${blanks} 个空，请按顺序填写，用「；」分隔（如 3；-9）`;
  return '请填写答案（数学式可直接输入，如 -3/4）';
}

/** 旧版「题目配图」入口：题干里已有内联图片时不再重复渲染 */
export function legacyImageUrl(q: { id: number; image_path?: string; stem: string }): string {
  if (!q.image_path) return '';
  if (/!\[[^\]]*\]\(/.test(q.stem)) return '';
  return `/api/v1/question-images/${q.id}`;
}

export interface QuizSummary {
  correct: number;
  wrong: number;
  manual: number;
  unanswered: number;
  /** 与后端一致的得分率（score / 全课时题数） */
  percent: number;
}

/** 结果统计：正确/错误/待自评/未答与得分率 */
export function summarizeQuiz(result: QuizSubmitResult | null, questionCount = 0): QuizSummary {
  const results = result?.results ?? [];
  const correct = results.filter((r) => r.correct === true).length;
  const wrong = results.filter((r) => r.correct === false).length;
  const manual = results.filter((r) => r.correct === null).length;
  const total = result?.total ?? questionCount;
  const percent = result && total > 0 ? Math.round((result.score / total) * 100) : 0;
  return {
    correct,
    wrong,
    manual: result?.manual ?? manual,
    unanswered: Math.max(0, questionCount - results.length),
    percent,
  };
}
