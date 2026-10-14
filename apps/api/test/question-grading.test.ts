/**
 * 填空题判分与空位提示：题库导入后大量题目是「多空 + 一空多解」，判分必须按空位逐个比对。
 */
import { describe, expect, it } from 'vitest';
import type { QuestionType } from '@microclass/shared';
import { checkAnswer, fillBlankAnswers, fillBlankCount } from '../src/domain/question.js';

const fill = (answer: string) => ({ type: 'fill' as QuestionType, answer });

describe('填空题判分', () => {
  it('单个空：任一可接受写法都算对，大小写与空格归一', () => {
    const q = fill('main|Main');
    expect(checkAnswer(q, 'main')).toBe(true);
    expect(checkAnswer(q, ' MAIN ')).toBe(true);
    expect(checkAnswer(q, 'mian')).toBe(false);
    expect(checkAnswer(q, '')).toBe(false);
  });

  it('多个空：按顺序用「；」或「;」分隔，逐空比对', () => {
    const q = fill('-\\frac{3}{4}；4；5');
    expect(checkAnswer(q, '-\\frac{3}{4}；4；5')).toBe(true);
    expect(checkAnswer(q, '-\\frac{3}{4};4;5')).toBe(true);
    expect(checkAnswer(q, ' -\\frac{3}{4} ； 4 ； 5 ')).toBe(true);
    expect(checkAnswer(q, '-\\frac{3}{4}；4；6')).toBe(false);
  });

  it('空的个数不符时判错（避免漏答被算对）', () => {
    const q = fill('3；2');
    expect(checkAnswer(q, '3')).toBe(false);
    expect(checkAnswer(q, '3；2；1')).toBe(false);
  });

  it('每个空各自支持多种等价写法', () => {
    const q = fill('\\frac{3}{2}|1\\frac{1}{2}；0.25|\\frac{1}{4}');
    expect(checkAnswer(q, '\\frac{3}{2}；0.25')).toBe(true);
    expect(checkAnswer(q, '1\\frac{1}{2}；\\frac{1}{4}')).toBe(true);
    // 数学等价的写法也算对：`1.5` 与 `3/2`、`0.25` 与 `1/4` 是同一个数
    // （取舍说明：这样"把小数化成分数"这类要求写法的题会偏宽松，
    //   但反过来把 `0.4` 判错更常见、更伤学生，所以默认宽容）
    expect(checkAnswer(q, '1.5；0.25')).toBe(true);
    // 数值不等价仍然判错
    expect(checkAnswer(q, '1.6；0.25')).toBe(false);
    expect(checkAnswer(q, '1.5；0.3')).toBe(false);
  });

  it('写法差异不改变判分结果：LaTeX 装饰、全角、OCR 空格、中文数字、「或」分隔', () => {
    expect(checkAnswer(fill('\\left(2,0\\right)'), '(2,0)')).toBe(true);
    expect(checkAnswer(fill('＋；-'), '+；-')).toBe(true);
    expect(checkAnswer(fill('1；-10'), '1；- 1 0')).toBe(true);
    expect(checkAnswer(fill('7'), '七')).toBe(true);
    expect(checkAnswer(fill('\\frac{2}{5}(或)0.4'), '0.4')).toBe(true);
    // 真的不同答案依然判错
    expect(checkAnswer(fill('圆心'), '圆心上')).toBe(false);
    expect(checkAnswer(fill('1260'), '12600')).toBe(false);
  });

  it('选择题、判断题判分不受影响', () => {
    expect(checkAnswer({ type: 'single', answer: '1' }, '1')).toBe(true);
    expect(checkAnswer({ type: 'multiple', answer: '0,2' }, '2,0')).toBe(true);
    expect(checkAnswer({ type: 'judge', answer: 'T' }, 't')).toBe(true);
  });
});

describe('填空题空位数', () => {
  it('解析答案编码得到空位数与各空写法', () => {
    expect(fillBlankAnswers('a|b；c')).toEqual([['a', 'b'], ['c']]);
    expect(fillBlankCount('fill', '3；2；-9')).toBe(3);
    expect(fillBlankCount('fill', '3')).toBe(1);
    expect(fillBlankCount('short', '随便写写')).toBe(0);
    expect(fillBlankCount('fill', '')).toBe(0);
  });
});
