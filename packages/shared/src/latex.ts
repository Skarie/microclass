/**
 * 裸 LaTeX 识别：找出题面里**没写 `$` 定界**的公式片段。
 *
 * 为什么需要（真机普查 366,867 题）：
 *   - 「有 LaTeX 命令、但不在 `$...$` 里」：解析 **2,817** 行、题干 168 行、选项 60 行
 *     （大多是 AI 解析里写成 `\frac{3}{2}`、`\begin{vmatrix}...\end{vmatrix}` 的样子）；
 *   - 这些内容前端与打印侧都只认 `$...$`，于是**原样显示成源码** —— 用户反馈的
 *     「部分题目应该是公式却呈现成 md 形式」就是这一类。
 *
 * 这里只负责**定位**片段，渲染交给调用方（前端 KaTeX / 服务端 KaTeX）。
 * 两条保守原则：
 *   1. **命令白名单**：只认真正的 LaTeX 命令，`C:\Users`、`/var/log\Data` 这类路径不会被当真；
 *   2. 遇到中文或中文标点立即停下，不会把中文句子吞进公式。
 */

/** 中文与全角标点：公式片段到此为止 */
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
/** 公式字符（含空格、制表符——`\begin{cases} a & b` 里有空格） */
const MATH_CHAR = /[0-9a-zA-Z+\-*/=<>.,:;!|^_{}()[\]\\' \t~]/;

/**
 * 认得的 LaTeX 命令白名单。
 * 前半部分是**真机数据里实际出现过的**（普查 top：frac/begin/end/times/underline/phantom/sqrt/div/…），
 * 后半部分是标准数学命令，避免以后导入新题库时漏渲染。
 */
const LATEX_COMMANDS = [
  // 真机高频
  'frac',
  'dfrac',
  'tfrac',
  'begin',
  'end',
  'times',
  'underline',
  'overline',
  'phantom',
  'hphantom',
  'vphantom',
  'sqrt',
  'div',
  'enclose',
  'triangle',
  'cdots',
  'ldots',
  'left',
  'right',
  'quad',
  'qquad',
  // 结构 / 环境
  'array',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'Vmatrix',
  'cases',
  'align',
  'aligned',
  'gathered',
  'split',
  'hline',
  'cline',
  'text',
  'mathrm',
  'mathbf',
  'mathbb',
  'mathcal',
  'displaystyle',
  'textstyle',
  'limits',
  'nolimits',
  'stackrel',
  'overset',
  'underset',
  'binom',
  'choose',
  'rule',
  'hspace',
  'vspace',
  'space',
  // 符号
  'pm',
  'mp',
  'cdot',
  'dots',
  'le',
  'leq',
  'leqslant',
  'ge',
  'geq',
  'geqslant',
  'ne',
  'neq',
  'approx',
  'sim',
  'simeq',
  'cong',
  'equiv',
  'propto',
  'angle',
  'measuredangle',
  'parallel',
  'perp',
  'circ',
  'degree',
  'ast',
  'star',
  'bullet',
  'prime',
  'ell',
  'hbar',
  'partial',
  'nabla',
  'infty',
  'forall',
  'exists',
  'neg',
  'land',
  'lor',
  'implies',
  'iff',
  'in',
  'notin',
  'ni',
  'subset',
  'subseteq',
  'subsetneq',
  'supset',
  'supseteq',
  'cup',
  'cap',
  'uplus',
  'sqcup',
  'sqcap',
  'setminus',
  'oplus',
  'ominus',
  'otimes',
  'oslash',
  'odot',
  'bigcup',
  'bigcap',
  'bigoplus',
  'bigotimes',
  'bigvee',
  'bigwedge',
  'therefore',
  'because',
  'to',
  'mapsto',
  'rightarrow',
  'leftarrow',
  'leftrightarrow',
  'Rightarrow',
  'Leftarrow',
  'Leftrightarrow',
  'uparrow',
  'downarrow',
  'updownarrow',
  'vert',
  'Vert',
  'mid',
  'nmid',
  'langle',
  'rangle',
  'lfloor',
  'rfloor',
  'lceil',
  'rceil',
  'll',
  'gg',
  'doteq',
  'models',
  'vdash',
  'dashv',
  'top',
  'bot',
  'sum',
  'prod',
  'int',
  'iint',
  'oint',
  'lim',
  'log',
  'ln',
  'lg',
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'max',
  'min',
  'gcd',
  'lcm',
  'exp',
  'deg',
  'det',
  'dim',
  'ker',
  'hom',
  'arg',
  'bmod',
  'pmod',
  // 希腊字母
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
  // 装饰
  'vec',
  'bar',
  'hat',
  'tilde',
  'widehat',
  'widetilde',
  'overrightarrow',
  'overleftarrow',
  'dot',
  'ddot',
];

const COMMAND_RE = new RegExp(`\\\\(?:${LATEX_COMMANDS.join('|')})(?![a-zA-Z])`, 'g');
/** 不带 `g` 的版本：用于「这段文字里有没有命令」的判断（带 g 的 test 会记住 lastIndex，是个坑） */
const HAS_COMMAND_RE = new RegExp(`\\\\(?:${LATEX_COMMANDS.join('|')})(?![a-zA-Z])`);
/** 上下标锚点：`10^{2}`、`a_{1}` 这类没有命令但显然是公式 */
const SCRIPT_RE = /\^\{|_\{/g;

export interface BareLatexSpan {
  start: number;
  end: number;
  tex: string;
  /** `\begin{...}` 块按行间公式渲染（矩阵、竖式这类排版） */
  display: boolean;
}

/** 括号是否配平（`{` 与 `}` 数量一致且不交叉） */
function balancedBraces(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * 扫描 `text`，返回「没有 `$` 定界」的公式片段（按出现顺序，互不重叠）。
 * 调用方负责把这些片段之外的内容按普通文本渲染。
 */
export function scanBareLatex(text: string): BareLatexSpan[] {
  const src = String(text ?? '');
  if (!src) return [];
  const spans: BareLatexSpan[] = [];

  const anchors: number[] = [];
  for (const re of [COMMAND_RE, SCRIPT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) anchors.push(m.index);
  }
  anchors.sort((a, b) => a - b);

  for (const anchor of anchors) {
    if (spans.some((s) => anchor >= s.start && anchor < s.end)) continue;

    // 向前扩展（遇到中文/中文标点停）
    let start = anchor;
    while (start > 0 && MATH_CHAR.test(src[start - 1]!) && !CJK.test(src[start - 1]!)) start -= 1;

    // 向后扩展；`\begin{env}` 一路吃到匹配的 `\end{env}`
    let end = anchor + 1;
    const begin = /^\\begin\{([a-zA-Z*]+)\}/.exec(src.slice(anchor));
    let display = false;
    if (begin) {
      const endToken = `\\end{${begin[1]}}`;
      const endIdx = src.indexOf(endToken, anchor);
      if (endIdx >= 0) {
        end = endIdx + endToken.length;
        display = true;
      }
    }
    if (!display) {
      while (end < src.length && MATH_CHAR.test(src[end]!) && !CJK.test(src[end]!)) end += 1;
    }

    let tex = src.slice(start, end);
    // 去两端空白
    while (tex.length > 0 && /\s/.test(tex[0]!)) {
      start += 1;
      tex = tex.slice(1);
    }
    while (tex.length > 0 && /\s/.test(tex[tex.length - 1]!)) {
      end -= 1;
      tex = tex.slice(0, -1);
    }
    // 结尾句子标点不算公式（`\frac{1}{2}.`）
    while (tex.length > 0 && /[.,;:]/.test(tex[tex.length - 1]!) && balancedBraces(tex.slice(0, -1))) {
      end -= 1;
      tex = tex.slice(0, -1);
    }
    // 括号不配平就缩到配平（真机有 `\  -3pt]` 这种被压坏的写法）
    while (tex.length > 0 && !balancedBraces(tex)) {
      end -= 1;
      tex = tex.slice(0, -1);
    }
    // 必须以白名单命令或上下标结尾/开头才算公式（避免把普通文字吞进来）
    if (tex === '' || (!HAS_COMMAND_RE.test(tex) && !/\^\{|_\{/.test(tex))) continue;
    if (end <= start) continue;

    spans.push({ start, end, tex, display });
  }
  return spans.sort((a, b) => a.start - b.start);
}
