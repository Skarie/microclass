/**
 * 答案等价判定：全部用例都来自真机数据里真实出现的写法。
 *
 * 判分侧原来只认 `|` 作可接受写法、只做空白折叠，于是这些"同一答案的不同写法"
 * 会把学生判错，也会被「同题不同答案」台账当成真冲突。
 */
import { describe, expect, it } from 'vitest';
import {
  answersEquivalent,
  answerValueKey,
  mergeAnswerText,
  normalizeAnswerText,
  splitAnswerTokens,
} from '../src/domain/answerNormalize.js';

describe('答案文本归一化', () => {
  it('去掉 LaTeX 装饰（真机 2,769 行 \left/\right）', () => {
    expect(normalizeAnswerText('\\left(2,0\\right)')).toBe('(2,0)');
    expect(normalizeAnswerText('\\left[-1,6\\right]')).toBe('[-1,6]');
    expect(normalizeAnswerText('\\dfrac{1}{2}')).toBe('\\frac{1}{2}');
  });

  it('全角运算符与括号转半角（真机 663 行）', () => {
    expect(normalizeAnswerText('＋；-')).toBe('+；-');
    expect(normalizeAnswerText('（无）')).toBe('(无)');
    expect(normalizeAnswerText('10％')).toBe('10%');
  });

  it('多余反斜杠合并（真机 10\\\\% vs 10\\%）', () => {
    expect(normalizeAnswerText('10\\\\%')).toBe('10\\%');
  });

  it('纯数字片段里的 OCR 空格去掉', () => {
    expect(normalizeAnswerText('1；- 1 0')).toBe('1；-10');
  });

  it('含 LaTeX 命令的片段不能去空格（否则 \\ge x 粘成 \\gex —— 第一版踩过）', () => {
    expect(normalizeAnswerText('x\\le-5|-5\\ge x')).toBe('x\\le-5|-5\\ge x');
    expect(normalizeAnswerText('-4\\le m\\le0')).toBe('-4\\le m\\le0');
  });

  it('中文片段只折叠空白', () => {
    expect(normalizeAnswerText('圆心')).toBe('圆心');
    expect(normalizeAnswerText('同样  适用')).toBe('同样适用');
  });
});

describe('答案拆分：空与可接受写法', () => {
  it('`|` 与「或」都当分隔符（真机 2,555 行裸「或」）', () => {
    expect(splitAnswerTokens('\\frac{2}{5}(或)0.4')).toEqual([['\\frac{2}{5}', '0.4']]);
    expect(splitAnswerTokens('-5或-1')).toEqual([['-5', '-1']]);
    expect(splitAnswerTokens('x\\le7|7\\ge x')).toEqual([['x\\le7', '7\\ge x']]);
  });

  it('`；` 分空，多空保持顺序', () => {
    expect(splitAnswerTokens('五|5；5；\\frac{3}{5}')).toEqual([['五', '5'], ['5'], ['\\frac{3}{5}']]);
  });
});

describe('语义键：数值等价与不等式互换', () => {
  it('分数/小数/百分数等价', () => {
    expect(answerValueKey('\\frac{2}{5}')).toBe(answerValueKey('0.4'));
    expect(answerValueKey('\\frac{2}{5}')).toBe(answerValueKey('40\\%'));
    expect(answerValueKey('\\frac{3}{20}')).toBe(answerValueKey('0.15'));
  });

  it('带分数与假分数等价', () => {
    expect(answerValueKey('1\\frac{4}{21}')).toBe(answerValueKey('\\frac{25}{21}'));
  });

  it('不等式两侧互换等价（x\\le7 与 7\\ge x）', () => {
    expect(answerValueKey('x\\le7')).toBe(answerValueKey('7\\ge x'));
  });

  it('文字答案按归一化字符串比', () => {
    expect(answerValueKey('圆心')).toBe('raw:圆心');
  });
});

describe('等价判定（决定「能不能自动消解冲突」）', () => {
  it.each([
    ['LaTeX 装饰', '\\left(2,0\\right)', '(2,0)'],
    ['全角运算符', '＋；-', '+；-'],
    ['不等式两侧互换', 'x\\le7|7\\ge x', 'x\\le7'],
    ['(或) 与 | 混用', '\\frac{2}{5}(或)0.4', '\\frac{2}{5}'],
    ['多余反斜杠', '10\\\\%', '10\\%'],
    ['中文与数字写法', '7|七', '7'],
    ['OCR 空格', '1；- 1 0', '1；-10'],
    ['多余外层括号', '(a-0.5b)；18', 'a-0.5b；18'],
    ['两边接受同一组写法（(或) 与 | 混用）', '9000(或)8900；9', '9000|8900；9'],
  ])('同义写法判等价：%s', (_name, a, b) => {
    expect(answersEquivalent(a, b)).toBe(true);
  });

  it('一边多接受了不同值时不判等价（比值顺序不能随便认）', () => {
    expect(answersEquivalent('5:2|2:5；5:8|8:5', '5:2；5:8')).toBe(false);
  });

  it('括号没包住整串时不能剥（`(a)+(b)` 与 `a+b` 不等价）', () => {
    expect(answersEquivalent('(a)+(b)', 'a+b')).toBe(false);
  });

  it('过宽编码不判等价（`61|39；39|61` 逐空展开后能接受 `61；61` 这种错答）', () => {
    expect(answersEquivalent('61|39；39|61', '61；39')).toBe(false);
  });

  it('真的不同答案绝不能判等价（否则会把错答当成正确答案接受）', () => {
    // 真机实例：两个因数的积是 126，两个因数分别乘 10 后积是 12600（多数票 1260 是错的）
    expect(answersEquivalent('1260', '12600')).toBe(false);
    // 顶点在**圆心**的角叫圆心角；`圆心上` 是错的写法
    expect(answersEquivalent('圆心', '圆心上|圆心')).toBe(false);
    // 8 > 7-5，所以第二空是 `>`；另一来源写成 `<` 是错的
    expect(answersEquivalent('=；<；<', '=；>；<')).toBe(false);
    // 商 8 余 8 的两种写法结构不同（单空 vs 双空），交给人工
    expect(answersEquivalent('8；8', '8\\cdots\\cdots8')).toBe(false);
    // 相距 100t 还是 10t 取决于两人走向，必须人工
    expect(answersEquivalent('100t', '10t')).toBe(false);
  });
});

describe('合并可接受写法', () => {
  it('等价写法合并成 `|`，而不是二选一', () => {
    expect(mergeAnswerText('\\frac{2}{5}', '\\frac{2}{5}(或)0.4')).toBe('\\frac{2}{5}|0.4');
    expect(mergeAnswerText('x\\le7', 'x\\le7|7\\ge x')).toBe('x\\le7|7\\ge x');
  });

  it('多空逐空合并并去重', () => {
    expect(mergeAnswerText('7；5', '7|七；5')).toBe('7|七；5');
  });
});
