/**
 * 答案展示：把题库里存着的「原样答案」翻译成人能读的样子。
 *
 * 题库里的答案是**采集原样**，有两套约定（与导入器一致）：
 *   - 同一个空的多个可接受写法用 `|` 分隔：`\frac{3}{9}|\frac{1}{3}；4`
 *   - 填空题的多个空用 `；` 分隔：`270；390；40x+150(或)150+40x`
 *   - 数学答案经常是**不带 `$` 的裸 LaTeX**：`\frac{3\pi}{4}|0.75\pi|135^{\circ}`
 *
 * 真机数据：待核对的 1,201 道题里 458 道（38%）答案含裸 LaTeX 命令。
 * 直接 `{{ answer }}` 出来就是 `\frac{3}{9}|\frac{1}{3}；4` 这种「像 md 源码」的样子，
 * 老师看到的就是这个（用户反馈「答案全是 md 的格式」）。
 *
 * 注意：这里**只影响展示**，判分与写库永远用原始字符串。
 */

export interface AnswerOption {
  /** 该空的第几个候选写法（0 起） */
  index: number;
  /** 包好 `$...$` 之后可以直接交给 RichText 的片段 */
  rich: string;
}

export interface AnswerBlank {
  /** 第几个空（0 起） */
  index: number;
  options: AnswerOption[];
}

/**
 * 常见 LaTeX 命令白名单。
 *
 * 为什么用白名单而不是「反斜杠后面跟字母」：答案里也会出现 Windows 路径这类
 * `C:\Users` 文本，用正则泛匹配会把它们当公式渲染。
 */
const LATEX_COMMANDS = [
  'frac',
  'dfrac',
  'tfrac',
  'sqrt',
  'overline',
  'underline',
  'vec',
  'bar',
  'hat',
  'tilde',
  'times',
  'div',
  'cdot',
  'cdotp',
  'cdots',
  'ldots',
  'dots',
  'pm',
  'mp',
  'le',
  'leq',
  'ge',
  'geq',
  'ne',
  'neq',
  'approx',
  'sim',
  'cong',
  'equiv',
  'angle',
  'triangle',
  'parallel',
  'perp',
  'circ',
  'degree',
  'pi',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'theta',
  'lambda',
  'mu',
  'nu',
  'rho',
  'sigma',
  'tau',
  'phi',
  'chi',
  'psi',
  'omega',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'log',
  'ln',
  'lg',
  'lim',
  'sum',
  'prod',
  'int',
  'infty',
  'text',
  'mathrm',
  'left',
  'right',
  'quad',
  'qquad',
  'space',
  'in',
  'notin',
  'subset',
  'subseteq',
  'cup',
  'cap',
  'oplus',
  'otimes',
  'therefore',
  'because',
  'begin',
  'end',
  'pmod',
  'bmod',
];

const LATEX_COMMAND_RE = new RegExp(`\\\\(?:${LATEX_COMMANDS.join('|')})(?![a-zA-Z])`);

/** 这段文字像不像「不带 $ 的裸 LaTeX」（决定要不要包成公式交给 KaTeX） */
export function looksLikeLatex(text: string): boolean {
  const s = String(text ?? '');
  if (s === '') return false;
  if (s.includes('$')) return false; // 已经带定界符的交回 RichText 自己处理
  if (LATEX_COMMAND_RE.test(s)) return true;
  // `10^4`、`x^{2}`、`a_{1}` 这类上下标也算公式（中文答案里几乎不会出现 `^`）
  if (/\^[{0-9a-zA-Z]/.test(s) || /_\{[^}]*\}/.test(s)) return true;
  return false;
}

/** 裸 LaTeX 包成 `$...$`；已经是纯文本的原样返回 */
export function toRichMath(text: string): string {
  const s = String(text ?? '');
  return looksLikeLatex(s) ? `$${s}$` : s;
}

/**
 * 按 `|` 拆「同一个空的多个可接受写法」。
 *
 * 只有当拆分结果**没有空片段**时才认为是分隔符：
 * 答案 `|1-\sqrt{2}|`（绝对值）拆出来是 ['', '1-\\sqrt{2}', '']，这种要保持原样。
 */
export function splitAlternatives(text: string): string[] {
  const s = String(text ?? '');
  if (!s.includes('|') && !s.includes('｜')) return [s];
  const parts = s.split(/[|｜]/).map((p) => p.trim());
  if (parts.some((p) => p === '') || parts.length < 2) return [s];
  return parts;
}

/**
 * 把答案拆成「第几个空 → 该空的哪些写法」。
 *
 * 只有填空题才按 `；` 分空：选择题答案是 `A`/`AB`，简答题答案可能是整句话，
 * 里面出现分号属于正文，不该被当成多个空。
 */
export function splitAnswer(answer: string, type?: string): AnswerBlank[] {
  const s = String(answer ?? '');
  const blanks = type === 'fill' && /[；;]/.test(s) ? s.split(/[；;]/) : [s];
  return blanks.map((blank, index) => ({
    index,
    options: splitAlternatives(blank).map((opt, i) => ({ index: i, rich: toRichMath(opt) })),
  }));
}

/** 是否值得用「多空 / 多写法」的排版（只有一个空、一个写法时用不着） */
export function isMultiPart(blanks: AnswerBlank[]): boolean {
  return blanks.length > 1 || (blanks[0]?.options.length ?? 0) > 1;
}
