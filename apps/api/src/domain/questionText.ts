/**
 * 题目的**纯文本格式**（Markdown / Word 导入导出共用一套规则）。
 *
 * 为什么要有它：CSV 适合 Excel，但老师更多是在 Word、笔记软件或 AI 里写题。
 * 这里定义一种「人写得顺手、机器也读得准」的文本格式，Markdown（.md/.txt）
 * 与 Word（.docx 抽出的文本）都按同一套规则解析 —— 学一次，两种容器都能用。
 *
 * ```text
 * ### 1. 单选题
 * Java 中定义常量的关键字是？
 * A. const
 * B. final
 * C. static
 * D. define
 * 答案：B
 * 解析：final 修饰的变量为常量
 * ```
 *
 * 规则（尽量宽容，能识别常见写法）：
 * - **题型**：独立一行，可带 `#`/`**`/`[]`/`（）`/序号，如 `## 单选题`、`第 1 题 · 单选`、`[多选]`；
 *   也可以直接写在题干开头（`【判断题】Java 是编译型语言。`）；
 * - **题干**：题型行之后、直到选项/答案/解析行；多行会用空格接成一段；
 * - **选项**：`A. x`、`A、x`、`A)x`、`A．x`、`（A）x`、`- A. x` 均可；
 * - **答案**：`答案：`/`正确答案：`/`参考答案：`/`Answer:`；
 * - **解析**：`解析：`/`分析：`/`说明：`/`Explanation:`；
 * - 选项、答案、解析的**先后顺序无所谓**；题目之间用空行分隔即可。
 */
import type { Question, QuestionType } from '@microclass/shared';
import {
  TYPE_ALIAS,
  TYPE_LABEL,
  answerToCsv,
  parseOptions,
  assembleQuestion,
  type CsvQuestionRow,
  type QuestionDraft,
} from './question.js';

export interface TextParseResult {
  /** 校验通过、可直接入库的题目 */
  questions: CsvQuestionRow[];
  /** 无法解析的题目（含题目序号与原因），不阻断其它题 */
  errors: string[];
  /** 能导入但需要老师注意的地方（如忽略的图片链接） */
  warnings: string[];
}

const OPTION_RE = /^\s*(?:[-*+]\s+)?[（(]?([A-Fa-f])[)）.、．:：]\s*(.*)$/;
const ANSWER_RE = /^\s*(?:正确答案|参考答案|答案|answer)\s*[：:]\s*(.*)$/i;
const ANALYSIS_RE = /^\s*(?:解析|分析|说明|explanation)\s*[：:]\s*(.*)$/i;
const INLINE_TYPE_RE = /^\s*[【\[（(]\s*([^】\]）)]{1,6})\s*[】\]）)]\s*(.*)$/;
const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** 把一行「可能是题型标题」的文字归一化后查表 */
export function typeFromHeading(line: string): QuestionType | null {
  let t = line.trim();
  t = t.replace(/^#{1,6}\s*/, '');
  t = t.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  t = t.replace(/^第\s*\d+\s*题\s*[·:：\-—]?\s*/, '');
  t = t.replace(/^\d+\s*[.、)）]\s*/, '');
  t = t.replace(/[·\-—:：]\s*$/, '').trim();
  const bracket = /^[【\[（(]\s*([^】\]）)]{1,8})\s*[】\]）)]$/.exec(t);
  if (bracket?.[1]) t = bracket[1].trim();
  return TYPE_ALIAS[t.toLowerCase()] ?? TYPE_ALIAS[t] ?? null;
}

/** 去掉题干里的 Markdown 图片语法（图片请在题目编辑里单独上传） */
function stripImages(text: string, collect: string[]): string {
  return text
    .replace(IMAGE_RE, (_m, url: string) => {
      collect.push(url);
      return '';
    })
    .trim();
}

/**
 * 解析纯文本（Markdown / Word 抽出的文本）为题目草稿。
 * 逐题校验，失败题只记录原因，不影响其它题。
 */
export function parseQuestionText(text: string): TextParseResult {
  const src = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = src.split('\n');

  const questions: CsvQuestionRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let current: (QuestionDraft & { startLine: number }) | null = null;
  let seen = 0;

  const flush = (): void => {
    if (!current) return;
    const draft = current;
    current = null;
    seen += 1;
    const index = seen;
    if (!draft.stem.trim()) {
      errors.push(`第 ${index} 题（原文第 ${draft.startLine} 行）: 题干为空`);
      return;
    }
    const imageUrls: string[] = [];
    const stem = stripImages(draft.stem, imageUrls);
    const cleaned: QuestionDraft = { ...draft, stem };
    const result = assembleQuestion({
      type: cleaned.type,
      stem: cleaned.stem,
      options: cleaned.options,
      rawAnswer: cleaned.rawAnswer,
      analysis: cleaned.analysis,
      ...(cleaned.imageIndexes === undefined ? {} : { imageIndexes: cleaned.imageIndexes }),
    });
    if (!result.ok) {
      errors.push(`第 ${index} 题（原文第 ${draft.startLine} 行）: ${result.error}`);
      return;
    }
    if ((cleaned.imageIndexes?.length ?? 0) > 1) {
      warnings.push(
        `第 ${index} 题: 检测到 ${cleaned.imageIndexes?.length ?? 0} 张配图，只保留第一张（题目目前只支持一张配图）`,
      );
    }
    if (imageUrls.length > 0) {
      warnings.push(
        `第 ${index} 题: 忽略了 ${imageUrls.length} 个图片链接（${imageUrls[0] ?? ''}）—— 图片请在题目编辑里上传`,
      );
    }
    questions.push(result.question);
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // 先摘出图片标记（Word 导入时由 docx 读取器写成 `[[img:N]]`），剩余内容再按规则判断，
    // 避免标记混进题干
    const imageMarkers = [...line.matchAll(/\[\[img:(\d+)\]\]/g)].map((m) => Number(m[1]));
    const stripped = line.replace(/\[\[img:\d+\]\]/g, '');
    const trimmed = stripped.trim();

    // 题型标题行（必须整行只是题型）
    const headingType = trimmed === '' ? null : typeFromHeading(trimmed);
    if (headingType && !OPTION_RE.test(trimmed)) {
      flush();
      current = {
        type: headingType,
        stem: '',
        options: [],
        rawAnswer: '',
        analysis: '',
        startLine: lineNo,
      };
      return;
    }

    if (!current) {
      // 还没有题型：允许题干以【判断题】这种内联标记开头
      if (!trimmed) return;
      const inline = INLINE_TYPE_RE.exec(trimmed);
      const inlineType = inline?.[1] ? (TYPE_ALIAS[inline[1].trim()] ?? null) : null;
      if (!inlineType) return; // 题型之前的说明文字直接忽略（标题、导语等）
      current = {
        type: inlineType,
        stem: inline?.[2] ?? '',
        options: [],
        rawAnswer: '',
        analysis: '',
        startLine: lineNo,
        ...(imageMarkers.length === 0 ? {} : { imageIndexes: imageMarkers }),
      };
      return;
    }

    if (imageMarkers.length > 0) current.imageIndexes = [...(current.imageIndexes ?? []), ...imageMarkers];
    if (!trimmed) return;

    // 分隔线（--- / *** / ___）与普通标题（# 题库名）都不属于题干
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flush();
      current = null;
      return;
    }
    if (/^#{1,6}\s/.test(trimmed)) return;

    const answer = ANSWER_RE.exec(stripped);
    if (answer) {
      current.rawAnswer = (answer[1] ?? '').trim();
      return;
    }
    const analysis = ANALYSIS_RE.exec(stripped);
    if (analysis) {
      current.analysis = (analysis[1] ?? '').trim();
      return;
    }

    const option = OPTION_RE.exec(stripped);
    // 「A. xxx」样式的选项（带分隔符才算，避免把普通句子当选项）；
    // 选项、答案、解析的先后顺序不影响识别
    if (option) {
      const letter = (option[1] ?? 'A').toUpperCase();
      const text2 = (option[2] ?? '').trim();
      const idx = letter.charCodeAt(0) - 65;
      if (idx >= 0 && idx < 6) {
        current.options[idx] = text2;
        return;
      }
    }

    // 其余都算题干（多行接成一段）
    current.stem = current.stem ? `${current.stem} ${trimmed}` : trimmed;
  });

  flush();

  if (questions.length === 0 && errors.length === 0) {
    errors.push('没有解析到任何题目：请确认每道题都有题型（如「单选题」）与「答案：」行');
  }
  return { questions, errors, warnings };
}

/** 题目 → Markdown（可再次导入，也可直接贴进笔记软件） */
export function questionsToMarkdown(input: { title: string; questions: Question[]; withAnswers?: boolean }): string {
  const withAnswers = input.withAnswers !== false;
  const out: string[] = [`# ${input.title}`, '', `共 ${input.questions.length} 题 · 由微课堂导出`, ''];

  input.questions.forEach((q, i) => {
    const options = parseOptions(q.options);
    out.push(`### ${i + 1}. ${TYPE_LABEL[q.type]}`, '');
    out.push(q.stem, '');
    options.forEach((opt, oi) => {
      out.push(`${String.fromCharCode(65 + oi)}. ${opt}`);
    });
    if (options.length > 0) out.push('');
    if (withAnswers) {
      out.push(`答案：${answerToCsv(q)}`, '');
      if (q.analysis) out.push(`解析：${q.analysis}`, '');
    }
    out.push('---', '');
  });

  return out.join('\n');
}
