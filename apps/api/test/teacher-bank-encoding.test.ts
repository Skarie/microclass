/**
 * 「教师版题库」解析器的文本清洗与答案/难度值编码（纯函数）。
 */
import { describe, expect, it } from 'vitest';
import { encodeTeacherAnswer, parseDifficulty01, parseTeacherBankMarkdown } from '../src/domain/teacherBankParse.js';

describe('文本清洗', () => {
  it('`##` 是空位记号 → ____；字面量 `\\n` → 换行', () => {
    const cleaned = parseTeacherBankMarkdown(`### 第1题（填空题）

**题目：**

答案是 ##，过程见下：\\n第一步

**答案：** 42
`);
    expect(cleaned.questions[0]?.stem).toContain('答案是 ____');
    expect(cleaned.questions[0]?.stem).toContain('\n第一步');
  });

  it('JSON 转义残留 \\\\frac → \\frac（LaTeX 命令不被二次转义）', () => {
    const cleaned = parseTeacherBankMarkdown(`### 第1题（填空题）

**题目：**

计算 \\\\frac{1}{2} 的值

**答案：** 0.5
`);
    expect(cleaned.questions[0]?.stem).toBe('计算 \\frac{1}{2} 的值');
  });

  it('没有头部元信息也能解析（元信息为空、小节标题为空）', () => {
    const cleaned = parseTeacherBankMarkdown(`### 第1题（单选题）

**题目标识：** 1

**题目：** 题干

**选项：**

A. 甲
B. 乙

**答案：** A
`);
    expect(cleaned.meta.book).toBe('');
    expect(cleaned.title).toBe('');
    expect(cleaned.questions).toHaveLength(1);
  });
});

describe('答案与难度值编码', () => {
  it('单选/多选/判断/填空/简答', () => {
    expect(encodeTeacherAnswer('single', 'D')).toBe('3');
    expect(encodeTeacherAnswer('single', '（无）')).toBe('');
    expect(encodeTeacherAnswer('multiple', 'ACD')).toBe('0,2,3');
    expect(encodeTeacherAnswer('judge', '错误')).toBe('F');
    expect(encodeTeacherAnswer('judge', '×')).toBe('F');
    expect(encodeTeacherAnswer('judge', 'A')).toBe('T');
    expect(encodeTeacherAnswer('fill', '7；八')).toBe('7；八');
    expect(encodeTeacherAnswer('short', ' 参考答案 ')).toBe('参考答案');
  });

  it('难度值兼容 0.64 / 64 / 64% / 认不出', () => {
    expect(parseDifficulty01('0.64')).toBeCloseTo(0.64);
    expect(parseDifficulty01('64')).toBeCloseTo(0.64);
    expect(parseDifficulty01('64%')).toBeCloseTo(0.64);
    expect(parseDifficulty01(undefined)).toBeNull();
    expect(parseDifficulty01('未知')).toBeNull();
  });
});
