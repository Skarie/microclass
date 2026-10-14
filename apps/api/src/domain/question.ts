/**
 * 题目领域逻辑（纯函数，无 IO）：
 * 答案编码、判分规则、CSV 题型别名。
 *
 * 答案编码与 V1 保持完全一致，保证历史数据可读：
 * - single   选项下标字符串，如 "1"
 * - multiple 选项下标逗号列表（升序去重），如 "0,2"
 * - judge    "T" / "F"
 * - fill     文本；可用 `|`（也兼容 `(或)` 与「或」）分隔多个可接受答案
 * - short    参考答案文本（不自动判分）
 *
 * 判分对「同一答案的不同写法」是宽容的（见 domain/answerNormalize.ts）：
 * `\left(2,0\right)`=`(2,0)`、`\frac{2}{5}`=`0.4`、`7`=`七`、`x\le7`=`7\ge x`。
 */
import type { QuestionType } from '@microclass/shared';
import { asText } from '../utils/text.js';
import { answerValueKey, splitAnswerTokens } from './answerNormalize.js';
import { createHash } from 'node:crypto';

/** CSV 中的题型写法 → 内部题型 */
export const TYPE_ALIAS: Record<string, QuestionType> = {
  单选: 'single',
  单选题: 'single',
  single: 'single',
  多选: 'multiple',
  多选题: 'multiple',
  multiple: 'multiple',
  判断: 'judge',
  判断题: 'judge',
  judge: 'judge',
  填空: 'fill',
  填空题: 'fill',
  fill: 'fill',
  简答: 'short',
  简答题: 'short',
  short: 'short',
};

/** 内部题型 → 中文名（导出与界面展示） */
export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

/** 判断题文本 → T/F */
export function judgeValue(raw: unknown): 'T' | 'F' | '' {
  const v = asText(raw).trim().toLowerCase();
  if (['对', '正确', '√', 't', 'true', '是', 'yes', '1'].includes(v)) return 'T';
  if (['错', '错误', '×', 'f', 'false', '否', 'no', '0'].includes(v)) return 'F';
  return '';
}

/** 字母串（如 "ACD"）→ 选项下标数组（去重升序，仅 A-F） */
export function letterIndexes(raw: unknown): number[] {
  const out: number[] = [];
  for (const ch of asText(raw).toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 70) out.push(code - 65);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** 选项下标数组 → 字母串（导出 CSV 用） */
export function indexesToLetters(indexes: number[]): string {
  return indexes.map((i) => String.fromCharCode(65 + i)).join('');
}

/** 解析入库的 options 字段（JSON 字符串） */
export function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s));
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

/**
 * 规范化答案：把界面/CSV 传入的写法收敛成入库编码。
 * 越界或不合法的答案返回空串，由调用方决定是否报错。
 */
export function normalizeAnswer(type: QuestionType, answer: unknown, options: string[]): string {
  if (type === 'single') {
    const i = Number.parseInt(asText(answer), 10);
    return Number.isInteger(i) && i >= 0 && i < options.length ? String(i) : '';
  }
  if (type === 'multiple') {
    const parts = asText(answer)
      .split(',')
      .map((x) => Number.parseInt(x, 10))
      .filter((x) => Number.isInteger(x) && x >= 0 && x < options.length);
    return [...new Set(parts)].sort((a, b) => a - b).join(',');
  }
  if (type === 'judge') return judgeValue(answer);
  return asText(answer).trim();
}

/**
 * 填空题答案 → 每个空的「可接受写法」列表。编码：`空1写法a|写法b；空2…`
 *
 * 分隔符识别统一走 `splitAnswerTokens`：除了 `|`，还认得题库里实际存在的
 * `(或)`/`（或）`（1,278 行）与裸「或」（2,555 行）—— 以前只认 `|`，
 * 于是 `\frac{2}{5}(或)0.4` 这种答案里学生写 `0.4` 会被判错。
 */
export function fillBlankAnswers(answer: unknown): string[][] {
  return splitAnswerTokens(answer);
}

/** 填空题空位数量（用于给学生提示「共 N 空」；非填空题返回 0） */
export function fillBlankCount(type: QuestionType, answer: unknown): number {
  return type === 'fill' ? fillBlankAnswers(answer).length : 0;
}

function matchesBlank(alts: string[], given: string, normalized: (s: string) => string): boolean {
  const target = normalized(given).replace(/[；;]$/, '');
  if (!target) return false;
  return alts.some(
    (alt) =>
      normalized(alt) === target ||
      // 写法差异也算对：`\left(2,0\right)` 与 `(2,0)`、`\frac{2}{5}` 与 `0.4`、`7` 与 `七`
      answerValueKey(alt) === answerValueKey(given),
  );
}

/**
 * 题目内容指纹（用于跨题库查重 / 去重）。
 *
 * 只取「题干 + 选项」而不含答案：这样同一道题在不同册次里出现能被认出来，
 * 而同一题干出现**不同答案**时也能被体检出来（重复且答案冲突，多半是数据质量问题）。
 *
 * 图片写法：只保留图片地址（`![](url)` → `url`），不保留 alt 文本。
 * 题库导入的图片是**内容寻址**的（`/api/v1/question-media/<sha1>.<ext>`），
 * 同一张图在不同包里地址相同 → 同一道题照样能认出来；
 * 反过来，「计算 ![图A]」和「计算 ![图B]」是**两道不同的题**，
 * 必须指纹不同 —— 否则会把不同题目并成一组（实测：早期版本因此把
 * 280 道不同的看图计算题算成「同题不同答案」的一组，771 组里 555 组题干带图）。
 *
 * 归一化：去空白与常见标点、全角转半角、小写。
 */
export function questionFingerprint(stem: unknown, options: string[]): string {
  const norm = (s: string): string =>
    s
      .replace(/!\[[^\]]*\]\(([^)]*)\)/g, '$1') // 图片只保留地址（内容寻址 → 同图同址、异图异址）
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s\-—_·、,，.。:：;；'"“”‘’()（）[\]【】<>《》$]/g, '')
      .toLowerCase();
  const payload = `${norm(asText(stem))}|${options.map((o) => norm(o)).join('|')}`;
  return createHash('sha1').update(payload).digest('hex');
}

/**
 * 题目是否带配图：题干 / 选项 / 解析里含本站题目图床链接（`/api/v1/question-media/…`）。
 * 与导入脚本 `ops/scripts/import-bank-manifest.mjs` 的口径保持一致，
 * 写入时算好存进 `questions.has_image`，体检就不必做 LIKE 全表扫描。
 */
export function hasQuestionImage(stem: unknown, options: string[], analysis?: unknown): boolean {
  return [asText(stem), ...options, asText(analysis)].some((t) => t.includes('question-media'));
}

/** 去掉 `![alt](url)` 图片标记后还剩多少字（空白不算字） */
export function textWithoutImages(text: unknown): string {
  return asText(text)
    .replace(/!\[[^\]]*\]\([^)\s]*\)/g, '')
    .replace(/\s+/g, '');
}

/**
 * 「解析只有图片、没有一个字」——真机上 19,507 道题是这样（图片里是解析文字截图）。
 *
 * 这类题在界面上只剩一张图：按关键字搜解析搜不到、按文字复制不出来、老师要改也无从下手。
 * 写入时算好存进 `questions.analysis_media_only`，体检能直接给出数量、题库里能筛出来，
 * 不必在请求路径上对 36.7 万行做 LIKE + 字符串剥离。
 *
 * 判定口径：**有图片**（本站题图或 http(s) 外链都算，真机有 11 道题解析指向外部图床）
 * 且去掉图片标记后一个字都不剩。
 */
export function hasMediaOnlyAnalysis(analysis: unknown): boolean {
  const raw = asText(analysis);
  if (raw === '') return false;
  if (!/!\[[^\]]*\]\([^)\s]*\)/.test(raw)) return false;
  return textWithoutImages(raw) === '';
}

/** 判分；返回 null 表示该题型需要人工/自检（简答题） */
export function checkAnswer(question: { type: QuestionType; answer: string }, given: unknown): boolean | null {
  const g = asText(given);
  switch (question.type) {
    case 'single':
      return g.trim() === String(question.answer).trim();
    case 'multiple': {
      const norm = (s: string): string =>
        s
          .split(',')
          .map((x) => Number.parseInt(x, 10))
          .filter((x) => !Number.isNaN(x))
          .sort((a, b) => a - b)
          .join(',');
      const a = norm(g);
      return a !== '' && a === norm(String(question.answer));
    }
    case 'judge':
      return g.trim().toUpperCase() === String(question.answer).trim().toUpperCase();
    case 'fill': {
      const normalized = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const target = normalized(g);
      if (!target) return false;
      const blanks = fillBlankAnswers(question.answer);
      // 多个空：学生按顺序用「；」分隔作答（与题库导入的编码一致）
      if (blanks.length > 1) {
        const given = target.split(/[；;]/).map((part) => part.trim());
        if (given.length !== blanks.length) return false;
        return blanks.every((blank, i) => matchesBlank(blank, given[i] ?? '', normalized));
      }
      const first = blanks[0];
      if (!first) return target === normalized(String(question.answer));
      return matchesBlank(first, target, normalized);
    }
    default:
      return null;
  }
}

/** 答案编码 → CSV 中的可读写法 */
export function answerToCsv(question: { type: QuestionType; answer: string }): string {
  const answer = String(question.answer ?? '');
  if (question.type === 'single') {
    const i = Number.parseInt(answer, 10);
    return Number.isInteger(i) ? String.fromCharCode(65 + i) : '';
  }
  if (question.type === 'multiple') {
    return indexesToLetters(
      answer
        .split(',')
        .map((x) => Number.parseInt(x, 10))
        .filter((x) => !Number.isNaN(x)),
    );
  }
  if (question.type === 'judge') return answer === 'T' ? '对' : '错';
  return answer;
}

export interface CsvQuestionRow {
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
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
  /** 题干里出现的配图序号（1 开始，可能多张，入库只保留第一张） */
  imageIndexes?: number[];
}

export interface QuestionDraftInput {
  type: QuestionType;
  stem: string;
  options: (string | undefined)[];
  rawAnswer: string;
  analysis?: string;
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
  });
}
