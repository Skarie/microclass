/**
 * 「题库_教师版」`题目.md` → 结构化题目（纯函数，无 IO）。
 *
 * 答案编码沿用平台既有格式（见 `domain/question.ts`）：
 *   single  选项下标字符串 "1"
 *   multiple 下标逗号列表 "0,2"
 *   judge   "T" / "F"
 *   fill    `空1写法|备选；空2…`（`@@` 视为同一空的等价写法）
 *   short   参考答案原文
 *
 * 稳健性：字段缺省不抛错（缺题干整题跳过）、题号重复无副作用、`---` 分隔符忽略、
 * 多选答案 `ABD`、填空多空、判断题 `正确/错误/对/错/√/×/A/B` 都能落成上述编码。
 */
import type { QuestionType } from '@microclass/shared';
import { asText } from '../utils/text.js';
import { judgeValue, letterIndexes } from './question.js';
import type { TeacherBankDoc, TeacherBankOption, TeacherQuestionDraft } from './teacherBankTypes.js';
import {
  cleanTeacherText,
  parseTeacherBankMeta,
  splitTeacherFields,
  splitTeacherQuestionBlocks,
  teacherBankTitle,
} from './teacherBankText.js';

/** 中文题型 → 内部题型；表外的题型归 short（并在 `unknownTypes` 里计数） */
const TYPE_BY_LABEL: Record<string, QuestionType> = {
  单选题: 'single',
  单选: 'single',
  多选题: 'multiple',
  多选: 'multiple',
  判断题: 'judge',
  判断: 'judge',
  填空题: 'fill',
  填空: 'fill',
  解答题: 'short',
  简答题: 'short',
  计算题: 'short',
  证明题: 'short',
  作图题: 'short',
  应用题: 'short',
  综合题: 'short',
};

const OPTION_RE = /^\s*([A-H])[.、．)）]\s*(.*)$/;
const IMAGE_REF = /!\[[^\]]*\]\((images\/[^)\s]+)\)/g;

/** 题型标签是否已知（未知题型会归入 short，并在导入报告里计数） */
export function isKnownTeacherTypeLabel(label: string): boolean {
  return TYPE_BY_LABEL[String(label ?? '').trim()] !== undefined;
}

/** 单选题：字母 → 0 基下标（多选字母串如 "ABD" 也认） */
function encodeChoice(raw: string, multiple: boolean): string {
  const indexes = letterIndexes(raw);
  if (indexes.length === 0) return '';
  return multiple ? indexes.join(',') : String(indexes[0]);
}

/** 判断题：正确/错误/对/错/√/× → T/F；也兼容 A/B 表示法 */
function encodeJudge(raw: string): string {
  const parsed = judgeValue(raw);
  if (parsed !== '') return parsed;
  const letter = raw.trim().toUpperCase();
  if (letter === 'A') return 'T';
  if (letter === 'B') return 'F';
  return '';
}

/**
 * 填空题答案 → 既有编码 `空1写法|备选；空2…`。
 * `$` 去掉（判分是纯文本比较），`@@` 当成同一空的另一种写法。
 */
function encodeFill(raw: string): string {
  return cleanTeacherText(raw)
    .replace(/\$/g, '')
    .split(/[；;]/)
    .map((blank) =>
      blank
        .split('@@')
        .map((alt) => alt.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('|'),
    )
    .filter(Boolean)
    .join('；');
}

/** 题型标签 + 原始答案 → 入库答案（无法识别时给空串，题目照样入库，便于后续补答案） */
export function encodeTeacherAnswer(type: QuestionType, raw: string): string {
  if (type === 'single') return encodeChoice(raw, false);
  if (type === 'multiple') return encodeChoice(raw, true);
  if (type === 'judge') return encodeJudge(raw);
  if (type === 'fill') return encodeFill(raw);
  return cleanTeacherText(raw);
}

/** 难度值 → 0~1；兼容 `0.64`、`64`、`64%` 三种写法，认不出返回 null */
export function parseDifficulty01(raw: unknown): number | null {
  const text = asText(raw).trim();
  const matched = /-?\d+(?:\.\d+)?/.exec(text.replace(/\s/g, ''));
  if (!matched) return null;
  const value = Number.parseFloat(matched[0]);
  if (!Number.isFinite(value)) return null;
  const ratio = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, ratio));
}

/** `A. 内容` 逐行拆选项；续行并入上一个选项（采集侧偶有多行公式） */
function parseOptions(raw: string): TeacherBankOption[] {
  const out: TeacherBankOption[] = [];
  for (const line of cleanTeacherText(raw).split('\n')) {
    const matched = OPTION_RE.exec(line);
    if (matched?.[1] !== undefined) {
      out.push({ no: matched[1].charCodeAt(0) - 65, content: (matched[2] ?? '').trim() });
      continue;
    }
    const last = out[out.length - 1];
    if (last && line.trim() !== '') last.content = `${last.content}\n${line.trim()}`;
  }
  return out;
}

/** 汇总一道题里引用到的图片（题干 / 选项 / 解析类字段都算），去重保序 */
function collectImages(...texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const matched of text.matchAll(IMAGE_REF)) {
      const ref = matched[1];
      if (ref !== undefined && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/** 解析一道题的正文 */
function parseQuestion(typeLabel: string, body: string, unknownTypes: string[]): TeacherQuestionDraft | null {
  const fields = splitTeacherFields(body);
  const resolveType = (): QuestionType => {
    const mapped = TYPE_BY_LABEL[typeLabel.trim()];
    if (mapped !== undefined) return mapped;
    if (!unknownTypes.includes(typeLabel.trim())) unknownTypes.push(typeLabel.trim());
    return 'short';
  };
  const type = resolveType();
  const text = (name: string): string => cleanTeacherText(fields.get(name) ?? '');

  const stem = text('题目');
  if (stem === '') return null;
  const options = parseOptions(fields.get('选项') ?? '');
  const analysis = text('解析');
  const ai = text('AI解析');
  const mergedAnalysis = [analysis, ai === '' ? '' : `【AI 解析】\n${ai}`].filter(Boolean).join('\n\n');
  const thought = text('解题思路');
  const method = text('解题方法');
  const points = text('相关知识点');

  return {
    type,
    typeLabel: typeLabel.trim(),
    sourceId: text('题目标识'),
    difficulty01: parseDifficulty01(fields.get('难度值')),
    stem,
    options,
    answer: encodeTeacherAnswer(type, text('答案')),
    analysis: mergedAnalysis,
    thought,
    method,
    points,
    images: collectImages(stem, ...options.map((o) => o.content), mergedAnalysis, thought, method, points),
  };
}

/** 整份 `题目.md` → 解析结果（题号重复、缺字段都不影响其它题） */
export function parseTeacherBankMarkdown(raw: string): TeacherBankDoc {
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const blocks = splitTeacherQuestionBlocks(text);
  const first = text.search(/^###\s*第\s*\d+\s*题\s*（/m);
  const preamble = first < 0 ? text : text.slice(0, first);
  const unknownTypes: string[] = [];
  const questions: TeacherQuestionDraft[] = [];
  for (const block of blocks) {
    const parsed = parseQuestion(block.typeLabel, block.body, unknownTypes);
    if (parsed) questions.push(parsed);
  }
  return {
    title: teacherBankTitle(preamble),
    meta: parseTeacherBankMeta(preamble),
    questions,
    unknownTypes,
  };
}
