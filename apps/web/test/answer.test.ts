/**
 * 答案展示：题库里的答案是「采集原样」——
 *   - 同一个空的多种写法用 `|`，填空题的多个空用 `；`
 *   - 数学答案经常是**不带 $ 的裸 LaTeX**（真机 1,201 道待核对题里 458 道这样）
 * 直接显示就是 `\frac{3}{9}|\frac{1}{3}；4` 这种源码样子（用户反馈「答案全是 md 的格式」）。
 */
import { describe, expect, it } from 'vitest';
import { isMultiPart, looksLikeLatex, splitAlternatives, splitAnswer, toRichMath } from '../src/utils/answer';

describe('裸 LaTeX 判定', () => {
  it('带 LaTeX 命令的算公式', () => {
    for (const s of ['\\frac{3}{9}', '\\sqrt{2}', '0.75\\pi', '135^{\\circ}', '\\frac{3\\pi}{4}']) {
      expect(looksLikeLatex(s)).toBe(true);
    }
  });

  it('上下标也算公式', () => {
    expect(looksLikeLatex('10^4')).toBe(true);
    expect(looksLikeLatex('x^{2}+1')).toBe(true);
  });

  it('中文答案、坐标、Windows 路径都不能被当成公式', () => {
    for (const s of ['圆心', '(3,4)', '容积|体积', 'C:\\Users\\test', '3,4', '40x+150(或)150+40x', '']) {
      expect(looksLikeLatex(s)).toBe(false);
    }
  });

  it('已经带 $ 定界符的交回 RichText 处理，不重复包', () => {
    expect(looksLikeLatex('$\\frac{1}{2}$')).toBe(false);
  });

  it('包成 $...$ 后可以直接交给 KaTeX', () => {
    expect(toRichMath('\\frac{1}{4}')).toBe('$\\frac{1}{4}$');
    expect(toRichMath('圆心')).toBe('圆心');
  });
});

describe('同一个空的多种写法（| 分隔）', () => {
  it('按 | 拆开', () => {
    expect(splitAlternatives('\\frac{3}{9}|\\frac{1}{3}')).toEqual(['\\frac{3}{9}', '\\frac{1}{3}']);
    expect(splitAlternatives('容积|体积')).toEqual(['容积', '体积']);
  });

  it('绝对值答案是 |1-\\sqrt{2}|（| 不是分隔符）→ 保持原样', () => {
    expect(splitAlternatives('|1-\\sqrt{2}|')).toEqual(['|1-\\sqrt{2}|']);
  });

  it('没有 | 时原样返回', () => {
    expect(splitAlternatives('圆心')).toEqual(['圆心']);
  });
});

describe('填空题的多个空（；分隔）', () => {
  it('填空题按 ； 分空，并给出每个空的写法', () => {
    const blanks = splitAnswer('\\frac{3}{9}|\\frac{1}{3}；4', 'fill');
    expect(blanks).toHaveLength(2);
    expect(blanks[0]?.options.map((o) => o.rich)).toEqual(['$\\frac{3}{9}$', '$\\frac{1}{3}$']);
    expect(blanks[1]?.options.map((o) => o.rich)).toEqual(['4']);
  });

  it('三道空、每空一种写法', () => {
    const blanks = splitAnswer('270；390；40x+150(或)150+40x', 'fill');
    expect(blanks.map((b) => b.options.map((o) => o.rich).join(''))).toEqual(['270', '390', '40x+150(或)150+40x']);
  });

  it('非填空题不按 ； 分空（答案里的分号属于正文）', () => {
    expect(splitAnswer('4；5', 'single')).toHaveLength(1);
    expect(splitAnswer('先化简；再求值', 'short')).toHaveLength(1);
  });

  it('只有一空一写法时不标序号', () => {
    expect(isMultiPart(splitAnswer('圆心', 'fill'))).toBe(false);
    expect(isMultiPart(splitAnswer('4；5', 'fill'))).toBe(true);
    expect(isMultiPart(splitAnswer('容积|体积', 'fill'))).toBe(true);
  });
});
