/**
 * 服务端试卷渲染：题面里的公式必须真的排版出来（打印稿不能是源码）。
 *
 * 真机背景：解析里 2,817 行、题干 168 行、选项 60 行是**没写 `$` 定界**的裸 LaTeX
 * （`\frac{3}{2}`、`\begin{vmatrix}...\end{vmatrix}`），前端与打印侧以前都只认 `$...$`。
 */
import { describe, expect, it } from 'vitest';
import { renderRichText } from '../src/domain/paperHtml.js';

describe('题面渲染：公式', () => {
  it('$ 定界的行内/行间公式渲染成 KaTeX', () => {
    expect(renderRichText('行内 $a+b$ 结束')).toContain('class="katex"');
    expect(renderRichText('独立 $$c=d$$')).toContain('katex-display');
  });

  it('裸 LaTeX 也渲染成 KaTeX（不再是源码）', () => {
    const html = renderRichText('首先将1.5转化为分数\\frac{3}{2}，原式变为…');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('\\frac');
    expect(html).toContain('首先将1.5转化为分数');
  });

  it('\\begin{...} 块按行间公式渲染', () => {
    const html = renderRichText('那么 \\begin{vmatrix} 3 & 2 \\\\ x & -x \\end{vmatrix} 等于…');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\begin{vmatrix}');
  });

  it('正文照旧转义（不能因为公式处理引入 XSS）', () => {
    const html = renderRichText('<script>alert(1)</script> 与 \\frac{1}{2}');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('class="katex"');
  });

  it('图片与公式可以混排', () => {
    const html = renderRichText('看图 ![](/api/v1/question-media/aaa.png) 再算 \\sqrt{9}');
    expect(html).toContain('<img class="pimg"');
    expect(html).toContain('class="katex"');
  });

  it('没有公式的纯文本不受影响（换行仍然处理）', () => {
    const html = renderRichText('第一行\n\n第二行');
    expect(html).toBe('第一行</p><p class="ptext">第二行');
  });
});
