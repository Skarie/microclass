/**
 * 题目编辑表单的纯数据逻辑：默认草稿、题目回填、保存前压缩选项。
 *
 * 从 use-question-list 抽出。这些转换不碰 Vue 状态、也不发请求，只是「题目 ↔ 表单」的搬运；
 * 留在编辑器组合式函数里会把新建/保存这些动作淹没，所以单独放到 utils。
 * 答案的解析与展示（answerIndexes / answerText / letter）也放这里：
 * 题库里的答案有两套历史写法（下标串 "0,2" 与字母串 "AC"），规则只该有一份。
 */
import type { QuestionType, QuestionView } from '@/api/types';

/** 选项草稿：用对象包裹，避免下标访问在 strict 下的 undefined 噪音 */
export interface OptionDraft {
  text: string;
}

/** 题目编辑表单的字段契约（与 QuestionEditor 的 props 对齐） */
export interface QuestionFormDraft {
  type: QuestionType;
  stem: string;
  options: OptionDraft[];
  singleAnswer: number;
  multipleAnswer: number[];
  judgeAnswer: string;
  textAnswer: string;
  analysis: string;
  sort: number;
  difficulty: string;
}

/** 选项下标 → A/B/C… */
export function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 存储的答案既可能是下标串（"0,2"），也可能是旧的字母串（"AC" / "A,C"） */
export function answerIndexes(raw: string | undefined): number[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  if (/^[A-Fa-f](,?[A-Fa-f])*$/.test(s)) {
    const letters: number[] = [];
    for (const ch of s.toUpperCase()) {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 70) letters.push(code - 65);
    }
    return [...new Set(letters)].sort((a, b) => a - b);
  }
  return s
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);
}

/** 表格里展示的答案：判断题/选择题转成人话，填空、简答原样返回 */
export function answerText(question: QuestionView): string {
  if (question.type === 'judge') return question.answer === 'T' ? '对' : '错';
  if (question.type === 'single' || question.type === 'multiple') {
    const letters = answerIndexes(question.answer).map(letter).join('');
    return letters || '—';
  }
  return question.answer ?? '—';
}

/** 空白表单：难度留空 = 交给难度模型自动判定（选了三档才记为人工标注） */
export function blankQuestionForm(): QuestionFormDraft {
  return {
    type: 'single',
    stem: '',
    options: [{ text: '' }, { text: '' }],
    singleAnswer: 0,
    multipleAnswer: [],
    judgeAnswer: 'T',
    textAnswer: '',
    analysis: '',
    sort: 0,
    difficulty: '',
  };
}

/**
 * 题目 → 表单草稿：按题型把答案回填到对应的输入位。
 * 只有「已人工标注」的题才回填难度档位；模型算出来的不预填，避免老师一保存就被当成人工标注。
 */
export function questionFormFrom(question: QuestionView): QuestionFormDraft {
  const form = blankQuestionForm();
  form.type = question.type;
  form.stem = question.stem;
  form.analysis = question.analysis ?? '';
  form.sort = question.sort;
  form.options =
    question.options.length > 0 ? question.options.map((text) => ({ text })) : [{ text: '' }, { text: '' }];
  const picked = answerIndexes(question.answer);
  if (question.type === 'single') form.singleAnswer = picked[0] ?? 0;
  if (question.type === 'multiple') form.multipleAnswer = picked;
  if (question.type === 'judge') form.judgeAnswer = question.answer === 'F' ? 'F' : 'T';
  if (question.type === 'fill' || question.type === 'short') form.textAnswer = question.answer ?? '';
  form.difficulty =
    question.difficulty_source === 'manual' &&
    (question.difficulty === 'easy' || question.difficulty === 'medium' || question.difficulty === 'hard')
      ? question.difficulty
      : '';
  return form;
}

/** 保存时丢弃空选项，并把答案下标重映射到过滤后的位置 */
export function compactOptions(options: OptionDraft[]): { texts: string[]; map: number[] } {
  const texts: string[] = [];
  const map: number[] = [];
  options.forEach((option, index) => {
    const text = option.text.trim();
    if (!text) return;
    texts.push(text);
    map.push(index);
  });
  return { texts, map };
}
