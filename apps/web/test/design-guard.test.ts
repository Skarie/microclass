/**
 * 设计约束测试（会失败的规范，而不是文档里的一句"请遵守"）。
 *
 * 约束一：**样式只走令牌** —— `apps/web/src` 里除 `styles/tokens.css` 外，
 *         不允许出现 `#hex` / `rgb()` / `hsl()` 字面量（含 `var(--x, #fff)` 这种死回退值）。
 * 约束二：**不许拿 emoji 当图标** —— 统一用 `components/Icon.vue`。
 *         例外：`★☆`（难度星级本身就是"字符评级"，跨平台字形一致，无需图标化）。
 *
 * 为什么要有：真机审计时发现 29 处硬编码色值与 60 处 emoji 图标，改主题/换品牌色时
 * 这些地方不会跟着变，靠人肉 review 一定漏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const TOKENS_FILE = path.join(SRC, 'styles', 'tokens.css');
const ALLOWED_EMOJI = new Set(['★', '☆']);

/**
 * 违规清单写文件：控制台对 emoji 的显示不可靠，写 UTF-8 文件更便于照着改。
 * **每次都重写**（包括通过时写"无违规"）—— 否则上一轮的旧清单会留在磁盘上误导人（我踩过）。
 */
function report(name: string, offenders: string[]): void {
  const dir = path.resolve(import.meta.dirname, '..', '..', '..', 'build', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const body = offenders.length === 0 ? '无违规 ✓\n' : `${offenders.join('\n')}\n`;
  fs.writeFileSync(path.join(dir, `design-guard-${name}.txt`), body);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(vue|css|ts)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(SRC).filter((f) => f !== TOKENS_FILE);
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/');

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
/**
 * 注意两点（都是踩过的坑）：
 *  1. 不能用 `[\uD83C-\uDBFF\uDC00-\uDFFF]` 这种代理对区间写法 —— 在 `u` 模式下列表范围按码点解释，
 *     相邻两个转义会被解析成一个巨大的码点区间，结果把 `-`、`：`、`，` 也当成 emoji；
 *  2. **不要把箭头范围（U+2190–U+21FF）算进来**：`课程 → 章节 → 题库`、`↑↓ 排序` 是正文符号不是图标，
 *     只 ban 真正的 emoji 区和被当图标用的符号区。
 */
const EMOJI_RE = /[\u{1F000}-\u{1F2FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

describe('设计约束：样式只走令牌', () => {
  it('组件与页面里没有硬编码色值（含 var() 的死回退值）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!/\.(vue|css)$/.test(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (COLOR_RE.test(line)) offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
      });
    }
    report('colors', offenders);
    expect(offenders, `发现硬编码色值 ${offenders.length} 处（清单见 build/reports/design-guard-colors.txt）`).toEqual(
      [],
    );
  });
});

describe('设计约束：图标统一走 Icon 组件', () => {
  it('没有拿 emoji 当图标（★☆ 除外）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.vue')) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const hits = [...line.matchAll(EMOJI_RE)].map((m) => m[0]).filter((ch) => !ALLOWED_EMOJI.has(ch));
        if (hits.length > 0) offenders.push(`${rel(file)}:${i + 1}  ${hits.join('')}  ${line.trim()}`);
      });
    }
    report('emoji', offenders);
    expect(offenders, `发现 emoji 图标 ${offenders.length} 处（清单见 build/reports/design-guard-emoji.txt）`).toEqual(
      [],
    );
  });
});
