/**
 * 题面富文本切分：图片前后的换行要被收掉（否则「几分之几」这种小图会把句子拆断）。
 */
import { describe, expect, it } from 'vitest';
import { isFigureImage, safeImageUrl, splitRichText } from '../src/utils/richText';

const IMG = '/api/v1/question-media/' + 'a'.repeat(40) + '.png';
const IMG2 = '/api/v1/question-media/' + 'b'.repeat(40) + '.png';

describe('题面切分', () => {
  it('图片前后的换行收成一个空格（句子不被拆断）', () => {
    const segs = splitRichText(`$\\frac{1}{2}$ 是真分数？\n\n![](${IMG})\n\n那么 $\\frac{3}{4}$ 呢？`);
    expect(segs.map((s) => s.kind)).toEqual(['math', 'text', 'image', 'text', 'math', 'text']);
    // 图片前面没有换行残留
    const before = segs[1];
    expect(before?.value.endsWith('\n')).toBe(false);
    expect(before?.value.endsWith(' ')).toBe(true);
    // 图片后面是单个空格，不再有换行
    const after = segs[3];
    expect(after?.value.startsWith(' ')).toBe(true);
    expect(after?.value.startsWith('\n')).toBe(false);
  });

  it('图片单独成段时不留空行', () => {
    const segs = splitRichText(`题目文字\n\n![](${IMG})`);
    expect(segs.map((s) => s.kind)).toEqual(['text', 'image']);
    expect(segs[0]?.value).toBe('题目文字 ');
  });

  it('行内公式与独立公式区分开', () => {
    const segs = splitRichText('行内 $a+b$ 与独立 $$c=d$$ 两种');
    expect(segs.filter((s) => s.kind === 'math').map((s) => s.display)).toEqual([false, true]);
  });

  it('没写 $ 定界的裸 LaTeX 也要切成公式（真机解析 2,817 行是这种写法）', () => {
    const segs = splitRichText('首先将1.5转化为分数\\frac{3}{2}，原式变为…');
    const math = segs.filter((s) => s.kind === 'math');
    expect(math.map((s) => s.value)).toEqual(['\\frac{3}{2}']);
    // 中文部分仍然是文本，不能被吞进公式
    expect(
      segs
        .filter((s) => s.kind === 'text')
        .map((s) => s.value)
        .join(''),
    ).toContain('首先将1.5转化为分数');

    const blocks = splitRichText('那么 \\begin{vmatrix} 3 & 2 \\\\ x & -x \\end{vmatrix} 等于…');
    const blockMath = blocks.filter((s) => s.kind === 'math');
    expect(blockMath).toHaveLength(1);
    expect(blockMath[0]?.display).toBe(true);
  });

  it('已经有 $ 定界的公式不会被重复切分', () => {
    const segs = splitRichText('设 $\\frac{a}{b}$ 与 \\frac{c}{d} 两种写法');
    const math = segs.filter((s) => s.kind === 'math');
    expect(math.map((s) => s.value)).toEqual(['\\frac{a}{b}', '\\frac{c}{d}']);
  });

  it('多张图片连续出现时都能保留', () => {
    const segs = splitRichText(`选项\n\n![](${IMG})\n![](${IMG2})`);
    expect(segs.filter((s) => s.kind === 'image')).toHaveLength(2);
  });

  it('危险或非白名单地址按纯文本渲染', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl('/etc/passwd')).toBeNull();
    expect(safeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    const segs = splitRichText('看这里 ![](javascript:alert(1)) 结束');
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
  });
});

describe('图片大小判定', () => {
  it('小图（公式碎片）按行内渲染，大图按整幅图渲染', () => {
    expect(isFigureImage(120, 30)).toBe(false); // 几分之几
    expect(isFigureImage(48, 48)).toBe(false); // 单个数字
    expect(isFigureImage(640, 480)).toBe(true); // 几何图形
    expect(isFigureImage(200, 260)).toBe(true); // 竖长图
  });
});
