/**
 * 答案等价判定：把「同一个答案的不同写法」认出来。
 *
 * 背景（真机实测）：
 *   - 判分侧 `fillBlankAnswers` 只把 `；` 当空分隔、`|` 当可接受写法，`matchesBlank` 只做
 *     trim/lowercase/空白折叠；
 *   - 而题库里实际存在这些写法（同一含义）：
 *       `\left(2,0\right)` / `(2,0)`              —— LaTeX 装饰
 *       `\frac{2}{5}(或)0.4` / `\frac{2}{5}`      —— 「或」当分隔符（1,278 行）
 *       `-5或-1` / `-5|-1`                        —— 裸「或」当分隔符（2,555 行）
 *       `＋；-` / `+；-`                          —— 全角运算符（663 行）
 *       `10\\%` / `10\%`                          —— 多余反斜杠
 *       `x\le7|7\ge x` / `x\le7`                  —— 不等式两侧互换
 *       `- 1 0` / `-10`                           —— OCR 把数字拆开的空格
 *   结果：学生按其中一种写法作答会被判错，而"同题不同答案"台账也会把这些当成真冲突。
 *
 * 本模块只做**不改变语义**的归一化 + 等价判定，供判分与冲突核对共用。
 */

import { asText } from '../utils/text.js';

/** 空白（`；`）→ 每个空的「可接受写法」列表 */
const BLANK_SEP = /[；;]/;
/** 同一个空的可接受写法分隔符：`|`、`或`、`(或)`、`（或）` */
const ALT_SPLIT = /\||（或）|\(或\)|或/g;

/**
 * 文本归一化（两边都做，因此只要求"同等程度的宽容"）：
 *   - LaTeX 装饰：`\left`/`\right`、`\,`/`\;`/`\!`、`\dfrac`/`\tfrac` → `\frac`
 *   - 多余反斜杠：`\\%` → `\%`
 *   - 全角 → 半角运算符、括号、逗号、冒号
 *   - 空格：**含中文或含 LaTeX 命令的片段只折叠**，纯数字/符号片段才全部去掉
 *     （否则 `\ge x` 会被粘成 `\gex` —— 这是第一版踩过的坑）
 */
export function normalizeAnswerText(input: unknown): string {
  let t = asText(input).trim();
  t = t.replace(/\\left|\\right/g, '');
  t = t.replace(/\\dfrac|\\tfrac/g, '\\frac');
  t = t.replace(/\\[,;!]/g, '');
  t = t.replace(/\\\\/g, '\\');
  t = t.replace(/（/g, '(').replace(/）/g, ')');
  t = t.replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%');
  t = t.replace(/，/g, ',').replace(/：/g, ':');
  return t
    .split(/([；;|])/)
    .map((seg) => {
      if (/[\u4e00-\u9fa5]/.test(seg)) return seg.replace(/\s+/g, '');
      if (seg.includes('\\')) return seg.replace(/\s{2,}/g, ' ').trim();
      return seg.replace(/\s+/g, '');
    })
    .join('');
}

/** 把答案拆成「空 → 可接受写法列表」（判分与比较共用同一套分隔符） */
export function splitAnswerTokens(answer: unknown): string[][] {
  return asText(answer)
    .split(BLANK_SEP)
    .map((blank) =>
      blank
        .split(ALT_SPLIT)
        .map((alt) => alt.trim())
        .filter(Boolean),
    )
    .filter((alts) => alts.length > 0);
}

/** 分数 / 带分数 / 百分数 / 小数 → 数值（认不出来返回 null） */
function numericValue(text: string): number | null {
  const t = text.trim();
  const mixed = /^(-?\d+)\\frac\{(\d+)\}\{(\d+)\}$/.exec(t);
  if (mixed) {
    const whole = Number(mixed[1]);
    const frac = Number(mixed[2]) / Number(mixed[3]);
    return whole < 0 ? whole - frac : whole + frac;
  }
  const frac = /^(-?)\\frac\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}$/.exec(t);
  if (frac) {
    const v = Number(frac[2]) / Number(frac[3]);
    return Number.isFinite(v) ? (frac[1] === '-' ? -v : v) : null;
  }
  const pct = /^(-?\d+(?:\.\d+)?)\\?%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/**
 * 中文数字 → 数值（`7|七`、`10|十`、`五|5`、`2(或)二` 这类写法在题库里很常见）。
 * 只支持到千位（答案里不会出现更大的中文数字），认不出来返回 null。
 */
const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

function chineseNumeralValue(text: string): number | null {
  const t = text.trim();
  if (!t || !/^[零〇一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟]+$/.test(t)) return null;
  let section = 0;
  let number = 0;
  for (const ch of t) {
    const digit = CN_DIGITS[ch];
    if (digit !== undefined) {
      number = digit;
      continue;
    }
    const unit = CN_UNITS[ch];
    if (unit === undefined) return null;
    // 「十二」= 12：单位前没有数字时按 1 算
    section += (number === 0 ? 1 : number) * unit;
    number = 0;
  }
  return section + number;
}

/** 不等式两侧互换：`a\le b` 与 `b\ge a` 是同一件事 */
function relationKey(t: string): string | null {
  const m = /^(.+?)(\\le|\\leq|\\ge|\\geq|<|>)(.+)$/.exec(t);
  if (!m) return null;
  // 注意 trim：归一化会保留 LaTeX 片段里的单个空格（`7\ge x`），不 trim 会让同一式子产生两个键
  const left = (m[1] ?? '').trim();
  const rawOp = m[2] ?? '';
  const right = (m[3] ?? '').trim();
  const op = rawOp === '\\le' || rawOp === '\\leq' || rawOp === '<' ? '<=' : '>=';
  const flip = op === '<=' ? '>=' : '<=';
  // 统一成 [小, 大] 的顺序：`a<b` 与 `b>a` 归一成 (<=, a, b)
  const [x, y] = [left, right].sort();
  if (x === left) return `rel:${op}:${x}:${y}`;
  return `rel:${flip}:${x}:${y}`;
}

/**
 * 去掉「包住整个片段」的多余括号：`(a-0.5b)` → `a-0.5b`、`(无)` → `无`。
 * 只在括号成对包裹整个片段时剥（`(3,4)` 也会剥成 `3,4`，与另一种写法一致）。
 */
function stripOuterParens(text: string): string {
  let t = text.trim();
  for (;;) {
    if (t.length < 2 || !t.startsWith('(') || !t.endsWith(')')) return t;
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < t.length; i += 1) {
      const ch = t[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        // 中途深度归零说明外层括号没包住整串（如 `(a)+(b)`）
        if (depth === 0 && i < t.length - 1) {
          wrapsWhole = false;
          break;
        }
      }
    }
    if (!wrapsWhole || depth !== 0) return t;
    t = t.slice(1, -1).trim();
  }
}

/**
 * 「同一个空里的可接受写法」的语义键：数值等价（`\frac{2}{5}` = `0.4` = `40\%`）优先，
 * 其次不等式互换，最后退回归一化字符串。
 */
export function answerValueKey(input: string): string {
  const t = stripOuterParens(normalizeAnswerText(input));
  const num = numericValue(t);
  if (num !== null) return `num:${Number(num.toFixed(6))}`;
  const cn = chineseNumeralValue(t);
  if (cn !== null) return `num:${cn}`;
  const rel = relationKey(t);
  if (rel) return rel;
  return `raw:${t}`;
}

/**
 * 两个答案是不是「同一个答案的不同写法」。
 *
 * 规则：空数相同，且**每个空里两边接受的答案集合相同**（按语义键比）。
 *   - `\frac{2}{5}(或)0.4` 与 `\frac{2}{5}` 等价（键集合都是 {num:0.4}）
 *   - `9000(或)8900；9` 与 `9000|8900；9` 等价（两边都接受 9000 或 8900）
 *   - `圆心` 与 `圆心上`、`1260` 与 `12600` 不等价（必须交给人/多数票判断）
 *   - `5:2|2:5；5:8|8:5` 与 `5:2；5:8` 不等价（前者多接受了 2:5，比值顺序不能随便认）
 */
export function answersEquivalent(a: unknown, b: unknown): boolean {
  const x = splitAnswerTokens(a);
  const y = splitAnswerTokens(b);
  if (x.length !== y.length) {
    // 单空 vs 多空：把两边的写法摊平后再比一次（`6；6` 与 `(6,6)` 这类坐标写法差异仍判不等价，
    // 因为数值集合不同；但 `A；B` 与 `A|B` 这种"分隔符用错"能被认出来）
    const flatX = [...new Set(x.flat().map(answerValueKey))].sort().join('|');
    const flatY = [...new Set(y.flat().map(answerValueKey))].sort().join('|');
    return flatX !== '' && flatX === flatY;
  }
  return x.every((alts, i) => {
    const keysX = new Set(alts.map(answerValueKey));
    const keysY = new Set((y[i] ?? []).map(answerValueKey));
    if (keysX.size !== keysY.size) return false;
    for (const key of keysX) if (!keysY.has(key)) return false;
    return true;
  });
}

/**
 * 合并两个等价答案的可接受写法（用于「同题不同答案」核对：
 * 与其二选一，不如把两种写法都接受，学生写哪个都对）。
 */
export function mergeAnswerText(a: unknown, b: unknown): string {
  const x = splitAnswerTokens(a);
  const y = splitAnswerTokens(b);
  if (x.length !== y.length) return normalizeAnswerText(a);
  return x
    .map((alts, i) => {
      const merged = [...alts, ...(y[i] ?? [])];
      // 按**归一化文本**去重（不是按语义键）：`\frac{2}{5}` 与 `0.4` 虽然数值相同，
      // 但两种写法都要保留给学生看；只有 `10\\%` 与 `10\%` 这种真重复才合并。
      const seen = new Set<string>();
      return merged
        .map((alt) => normalizeAnswerText(alt))
        .filter((alt) => {
          if (seen.has(alt)) return false;
          seen.add(alt);
          return true;
        })
        .join('|');
    })
    .join('；');
}
