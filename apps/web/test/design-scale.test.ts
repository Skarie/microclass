/**
 * 设计规范门禁（按 docs/design-guidelines.md 第 4 节 + 第 5 节验收清单）。
 *
 * 为什么要有它：连续 5 版改版都栽在"取值失控"上 —— 10 种字号、14 种圆角、8 种字重、9 种行高。
 * 靠人肉 review 一定漏，所以把规范写成会失败的测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..', 'src');
const TOKENS = path.join(SRC, 'styles', 'tokens.css');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
};
/** 组件与页面文件（tokens.css 是唯一允许出现"原始设计值"的地方） */
const componentFiles = walk(SRC).filter((f) => f !== TOKENS);
const entries = componentFiles.map((f) => ({
  file: path.relative(SRC, f).replace(/\\/g, '/'),
  text: fs.readFileSync(f, 'utf8'),
}));

const findViolations = (re: RegExp, allow: (m: string) => boolean = () => false) => {
  const bad: string[] = [];
  for (const { file, text } of entries) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const v = m[1] ?? m[0];
        if (!allow(v)) bad.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  return bad;
};

/** 字面量字号必须是 6 档之一（12/13/14/16/22/28/32）；推荐直接用 token */
const ALLOWED_FONT_PX = new Set(['12', '13', '14', '16', '22', '28', '32']);

describe('设计规范：取值必须收敛', () => {
  it('① 字号只用 6 档（且推荐 token）', () => {
    const bad = findViolations(/font-size:\s*(\d+)px/g, (v) => ALLOWED_FONT_PX.has(v));
    expect(bad, `越界字号：\n${bad.join('\n')}`).toEqual([]);
  });

  it('② 圆角只用 token（特殊情况仅允许 50% 与 inherit）', () => {
    const bad = findViolations(/border-radius:\s*([^;\n]+)/g, (v) => {
      const t = v.trim();
      // 允许：纯 token、含 token 的复合值（如 0 0 token token）、0、inherit
      if (t.includes('var(--mc-radius')) return true;
      return t === 'zero' || t === 'inherit' || /^0(?:\s+0)*$/.test(t);
    });
    expect(bad, `越界圆角：\n${bad.join('\n')}`).toEqual([]);
  });

  it('③ 间距是 4 的倍数（允许 1px 作为发丝线）', () => {
    const bad = findViolations(
      /(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?:\s*([^;\n]+)/g,
      (v) => {
        const nums = [...v.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
        return nums.every((n) => n === 1 || n % 4 === 0);
      },
    );
    expect(bad, `非 4 栅格间距：\n${bad.join('\n')}`).toEqual([]);
  });

  it('④ 字重只用 token（禁止裸数字）', () => {
    const bad = findViolations(/font-weight:\s*(\d+)/g, () => false);
    expect(bad, `裸字重：\n${bad.join('\n')}`).toEqual([]);
  });

  it('⑤ 行高只用 token（禁止裸数值）', () => {
    const bad = findViolations(/line-height:\s*([\d.]+)(?![\d%px])/g, () => false);
    expect(bad, `裸行高：\n${bad.join('\n')}`).toEqual([]);
  });

  it('⑥ 不用"侧边色条"做装饰（反模式 #1/#5）', () => {
    const bad = findViolations(/border-(?:left|right):\s*(\d+)px\s+solid/g, (v) => Number(v) < 2);
    expect(bad, `侧边色条：\n${bad.join('\n')}`).toEqual([]);
  });

  it('⑦ 不用渐变做装饰（反模式 #13）', () => {
    const bad = findViolations(/background(?:-image)?:\s*([^;\n]*linear-gradient[^;\n]*)/g, () => false);
    expect(bad, `组件内渐变：\n${bad.join('\n')}`).toEqual([]);
  });
});
