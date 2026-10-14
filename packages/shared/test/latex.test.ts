/**
 * 裸 LaTeX 识别：用例全部取自真机普查里真实出现的文本
 * （解析里 2,817 行、题干 168 行、选项 60 行是「有 LaTeX 命令但没 `$` 定界」）。
 */
import { describe, expect, it } from 'vitest';
import { scanBareLatex } from '../src/latex.js';

const tex = (s: string) => scanBareLatex(s).map((x) => x.tex);

describe('裸 LaTeX 定位', () => {
  it('中文句子里的行内命令：只包住公式本身', () => {
    expect(tex('首先将1.5转化为分数\\frac{3}{2}，原式变为…')).toEqual(['\\frac{3}{2}']);
    expect(tex('根据“劳格数”定义d(10)=1；因为10^{2}=100')).toEqual(['10^{2}=100']);
  });

  it('上下标与运算符一起包（不能只包命令）', () => {
    expect(tex('2^{9\\div3}=8 个细胞，第二问…')).toEqual(['2^{9\\div3}=8']);
    expect(tex('-3\\frac{2}{3} = - (3 + \\frac{2}{3})=-3')).toEqual(['-3\\frac{2}{3} = - (3 + \\frac{2}{3})=-3']);
  });

  it('\\begin{...} 块整段包住，并按行间公式标记', () => {
    const s = scanBareLatex('上述式子等于$ad-bc$，那么 \\begin{vmatrix} 3 & 2 \\\\ x & -x \\end{vmatrix} 的值是…');
    expect(s).toHaveLength(1);
    expect(s[0]?.display).toBe(true);
    expect(s[0]?.tex).toContain('\\begin{vmatrix}');
    expect(s[0]?.tex).toContain('\\end{vmatrix}');
  });

  it('已经写在 $...$ 里的不重复识别（调用方只对文本片段调用本函数）', () => {
    // 本函数不解析 $ 定界，调用方负责先切出 $...$；这里确保单个命令仍能被定位
    expect(tex('\\sqrt{5}+\\sqrt{2}=\\sqrt{5+2}=\\sqrt{7}')).toEqual(['\\sqrt{5}+\\sqrt{2}=\\sqrt{5+2}=\\sqrt{7}']);
  });

  it('结尾句子标点不算公式内容', () => {
    expect(tex('结果是 \\frac{1}{2}.')).toEqual(['\\frac{1}{2}']);
    expect(tex('值为 \\sqrt{9},')).toEqual(['\\sqrt{9}']);
  });

  it('中文与中文标点会截断公式', () => {
    expect(tex('\\frac{1}{2}就是一半')).toEqual(['\\frac{1}{2}']);
    expect(tex('先算\\sqrt{9}，再算\\frac{1}{2}。')).toEqual(['\\sqrt{9}', '\\frac{1}{2}']);
  });

  it('被压坏的数据（括号不配平）会缩到配平为止，不吞掉后面的中文', () => {
    const s = scanBareLatex('548 \\\\ $ -3pt]-\\underline {\\phantom{2}abc} 的和');
    for (const span of s) {
      expect(span.tex).not.toContain('和');
      expect((span.tex.match(/\{/g) ?? []).length).toBe((span.tex.match(/\}/g) ?? []).length);
    }
  });

  it('路径文本不误判为公式', () => {
    expect(tex('C:\\Users\\test 目录')).toEqual([]);
    expect(tex('/var/log\\Data 路径')).toEqual([]);
  });

  it('没有 LaTeX 命令时返回空', () => {
    expect(tex('这是一道普通的中文题目，没有任何公式。')).toEqual([]);
    expect(tex('')).toEqual([]);
  });

  it('多个公式按出现顺序返回且不重叠', () => {
    const spans = scanBareLatex('\\frac{1}{2} 与 \\sqrt{3} 与 \\times 2');
    expect(spans.map((s) => s.tex)).toEqual(['\\frac{1}{2}', '\\sqrt{3}', '\\times 2']);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
  });
});
