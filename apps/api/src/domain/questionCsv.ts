/**
 * 题目导入草稿（CSV 行 / Markdown 题块）的校验与列映射。
 *
 * 从 `domain/question.ts` 拆出：这组函数只处理「用户写法 → 入库结构」，
 * 与答案编码/判分/指纹无关；迁移 0025 起同时支持可选的章节 / 小节。
 */
import type { QuestionType } from '@microclass/shared';
import { TYPE_ALIAS, judgeValue, letterIndexes } from './question.js';

/** 章节 / 小节文本上限（与请求体 schema、服务端 trim 保持一致） */
export const QUESTION_SECTION_MAX = 120;

export interface CsvQuestionRow {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  /** 章节 / 小节（迁移 0025，可空） */
  chapter: string;
  section: string;
  /** Word 导入时该题配图在文档图片列表里的序号（1 开始）；CSV 路径没有 */
  imageIndex?: number;
}

/** 待校验的题目草稿（CSV 行 / Markdown 块都先变成它，再统一走 assembleQuestion） */
export interface QuestionDraft {
  type: QuestionType;
  stem: string;
  options: (string | undefined)[];
  /** 用户写法：选择题是字母串、判断是 对/错、填空/简答是文本 */
  rawAnswer: string;
  analysis: string;
  /** 章节 / 小节（Markdown 的「章节：」「小节：」行，可空） */
  chapter?: string;
  section?: string;
  /** 题干里出现的配图序号（1 开始，可能多张，入库只保留第一张） */
  imageIndexes?: number[];
}

export interface QuestionDraftInput {
  type: QuestionType;
  stem: string;
  options: (string | undefined)[];
  rawAnswer: string;
  analysis?: string;
  chapter?: string;
  section?: string;
  imageIndexes?: number[];
}

export type CsvRowResult = { ok: true; question: CsvQuestionRow } | { ok: false; error: string };

/**
 * 草稿 → 入库前的题目（校验 + 答案编码）。
 * CSV 与 Markdown / Word 导入共用同一套规则，保证「同一种写法导入结果一致」。
 */
export function assembleQuestion(input: QuestionDraftInput): CsvRowResult {
  const stem = String(input.stem ?? '').trim();
  if (!stem) return { ok: false, error: '题干为空' };

  const raw = input.options ?? [];
  const filled = raw.map((s) => String(s ?? '').trim());
  const lastFilled = filled.reduce((acc, s, i) => (s !== '' ? i : acc), -1);
  for (let i = 0; i <= lastFilled; i += 1) {
    if ((filled[i] ?? '') === '') {
      return { ok: false, error: `选项字母不连续：缺少 ${String.fromCharCode(65 + i)}` };
    }
  }
  const options = filled.filter((s) => s !== '');
  const rawAnswer = String(input.rawAnswer ?? '').trim();
  const analysis = String(input.analysis ?? '').trim();
  const chapter = String(input.chapter ?? '')
    .trim()
    .slice(0, QUESTION_SECTION_MAX);
  const section = String(input.section ?? '')
    .trim()
    .slice(0, QUESTION_SECTION_MAX);
  let answer = '';

  if (input.type === 'single' || input.type === 'multiple') {
    if (options.length < 2) return { ok: false, error: '选择题至少两个选项' };
    const idxs = letterIndexes(rawAnswer);
    if (input.type === 'single') {
      if (idxs.length !== 1) return { ok: false, error: `单选答案应为单个字母(A-F)，收到: "${rawAnswer}"` };
      answer = String(idxs[0]);
    } else {
      if (idxs.length === 0) return { ok: false, error: `多选答案应为字母组合(如 ACD)，收到: "${rawAnswer}"` };
      answer = idxs.join(',');
    }
  } else if (input.type === 'judge') {
    answer = judgeValue(rawAnswer);
    if (!answer) return { ok: false, error: `判断答案应为 对/错，收到: "${rawAnswer}"` };
  } else {
    answer = rawAnswer;
    if (!answer) return { ok: false, error: '答案为空' };
  }

  const firstImage = input.imageIndexes?.[0];
  return {
    ok: true,
    question: {
      type: input.type,
      stem,
      options,
      answer,
      analysis,
      chapter,
      section,
      ...(firstImage === undefined ? {} : { imageIndex: firstImage }),
    },
  };
}

/** CSV 中列头 → 列下标映射 */
export interface CsvColumnMap {
  type?: number;
  stem?: number;
  options: number[];
  answer?: number;
  analysis?: number;
  chapter?: number;
  section?: number;
}

export function buildColumnMap(headerRow: string[]): CsvColumnMap {
  const map: CsvColumnMap = { options: [] };
  headerRow.forEach((h, i) => {
    const t = String(h).trim();
    // 选项列形如「选项A」；字母必须取自捕获组，不能按字符串下标取（中文占多字节字符位）
    const optionColumn = /^选项([A-Fa-f])$/.exec(t);
    if (/题型|类型|type/i.test(t)) map.type = i;
    else if (/题干|题目|内容|stem/i.test(t)) map.stem = i;
    else if (optionColumn) map.options[(optionColumn[1] ?? 'A').toUpperCase().charCodeAt(0) - 65] = i;
    else if (/答案|answer/i.test(t)) map.answer = i;
    else if (/解析|分析|explain/i.test(t)) map.analysis = i;
    else if (/小节|section/i.test(t)) map.section = i;
    else if (/章节|chapter/i.test(t)) map.chapter = i;
  });
  return map;
}

/** 无表头时的默认列序（与导入模板一致） */
export const DEFAULT_COLUMN_MAP: CsvColumnMap = {
  type: 0,
  stem: 1,
  options: [2, 3, 4, 5, 6, 7],
  answer: 8,
  analysis: 9,
  chapter: 10,
  section: 11,
};

const cell = (row: string[], idx: number | undefined): string =>
  idx === undefined ? '' : String(row[idx] ?? '').trim();

/** 一行 CSV → 题目（含校验错误信息） */
export function csvRowToQuestion(row: string[], map: CsvColumnMap): CsvRowResult {
  const type = TYPE_ALIAS[cell(row, map.type).toLowerCase()] ?? TYPE_ALIAS[cell(row, map.type)];
  if (!type) return { ok: false, error: `题型无法识别: "${cell(row, map.type)}"` };
  return assembleQuestion({
    type,
    stem: cell(row, map.stem),
    options: (map.options ?? []).map((i) => cell(row, i)),
    rawAnswer: cell(row, map.answer),
    analysis: cell(row, map.analysis),
    chapter: cell(row, map.chapter),
    section: cell(row, map.section),
  });
}
