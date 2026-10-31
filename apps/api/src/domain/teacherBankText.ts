/**
 * 「题库_教师版」`题目.md` 的文本处理（纯函数，无 IO）。
 *
 * 采集数据里有三类「脏」内容，必须在入库前统一（口径与既有导入脚本一致）：
 *   1. JSON 转义残留：`\\frac` 应为 `\frac`、字面量 `\n` 应为真换行；
 *   2. 空位记号不统一：`##`、`###`、`__________` 都是空位，统一成 `____`；
 *   3. 多余空行与行尾空白。
 *
 * 字段用 `**题目标识：** …` 这种加粗标签分隔，同一标签下的多行内容属于同一字段。
 */
import { asText } from '../utils/text.js';
import type { TeacherBankMeta } from './teacherBankTypes.js';

/** 一段正文里空位记号（`##` / `___`）的统一写法 */
const BLANK_MARK = '____';

/** 去掉采集残留的转义与多余空白；LaTeX（`$…$`、`\frac`）原样保留 */
export function cleanTeacherText(raw: unknown): string {
  const unescaped = asText(raw)
    .replace(/\\\\(?=[a-zA-Z])/g, '\\') // \\frac → \frac
    .replace(/\\n(?![a-zA-Z])/g, '\n') // 字面量 \n → 换行（\neq / \nu 等 LaTeX 命令不受影响）
    .replace(/\\t(?![a-zA-Z])/g, ' ')
    .replace(/\\r(?![a-zA-Z])/g, '');
  const lines = unescaped.split('\n').map((line) => {
    // Markdown 标题行（`## 标题`）原样保留；其余位置出现的 ## / ### 都是空位记号
    const body = /^#{1,6}\s/.test(line.trimStart()) ? line : line.replace(/#{2,4}(?!#)/g, BLANK_MARK);
    return body.replace(/_{2,}/g, BLANK_MARK).replace(/[ \t]+$/, '');
  });
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把一道题的正文切成「字段名 → 内容」。
 *
 * 只认 `**X：**` 开头的标签行（`**AI解析：**`、`**题目标识：**` 都算），
 * 没有标签的前缀归到 `head`。同一标签重复出现时按顺序拼接（采集侧偶有重复段）。
 */
export function splitTeacherFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  let current = 'head';
  const push = (name: string, text: string): void => {
    const prev = fields.get(name);
    fields.set(name, prev === undefined ? text : `${prev}\n${text}`);
  };
  for (const line of block.split('\n')) {
    const label = /^\*\*([^：*]{1,12})：\*\*\s*(.*)$/.exec(line.trim());
    if (label?.[1] !== undefined) {
      current = label[1];
      push(current, label[2] ?? '');
      continue;
    }
    push(current, line);
  }
  return fields;
}

/** 一行 `> 学科：数学　版本：…　章节：…` → 键值对（全角空格分隔多段） */
export function parseMetaLine(line: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = line.replace(/^\s*>\s?/, '');
  for (const part of body.split(/[\u3000\t]+/)) {
    const pair = /^([^：:]{1,12})[：:]\s*(.*)$/.exec(part.trim());
    if (pair?.[1] !== undefined) out.set(pair[1].trim(), (pair[2] ?? '').trim());
  }
  return out;
}

/** 文件头（第一条 `### 第N题` 之前）→ 元信息；缺失字段为空串 */
export function parseTeacherBankMeta(preamble: string): TeacherBankMeta {
  const merged = new Map<string, string>();
  for (const line of preamble.split('\n')) {
    if (!line.trimStart().startsWith('>')) continue;
    for (const [key, value] of parseMetaLine(line)) merged.set(key, value);
  }
  const total = Number.parseInt(merged.get('题目总数') ?? '', 10);
  return {
    subject: merged.get('学科') ?? '',
    version: merged.get('版本') ?? '',
    book: merged.get('书册') ?? '',
    chapter: merged.get('章节') ?? '',
    pointId: merged.get('知识点ID') ?? merged.get('知识点Id') ?? '',
    total: Number.isInteger(total) ? total : 0,
  };
}

/** 文件头的一级标题（`# 合并同类项`），没有则返回空串 */
export function teacherBankTitle(preamble: string): string {
  const matched = /^#\s+(.+)$/m.exec(preamble);
  return matched?.[1] ? cleanTeacherText(matched[1]) : '';
}

/**
 * 把整份 Markdown 按 `### 第N题（题型）` 切开。
 * 返回每题的题型标签与正文（正文不含标题行）；题号重复不影响（只用于展示）。
 */
export function splitTeacherQuestionBlocks(text: string): { typeLabel: string; body: string }[] {
  const marker = /^###\s*第\s*\d+\s*题\s*（([^）]+)）[^\n]*$/gm;
  const starts: { label: string; index: number; end: number }[] = [];
  for (let m = marker.exec(text); m !== null; m = marker.exec(text)) {
    starts.push({ label: m[1] ?? '', index: m.index, end: m.index + m[0].length });
  }
  return starts.map((cur, i) => ({
    typeLabel: cur.label,
    body: text.slice(cur.end, starts[i + 1]?.index ?? text.length),
  }));
}
