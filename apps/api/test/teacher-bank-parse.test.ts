/**
 * 「教师版题库」`题目.md` 解析器：字段、答案、难度值、图片引用与稳健性。
 */
import { describe, expect, it } from 'vitest';
import { isKnownTeacherTypeLabel, parseTeacherBankMarkdown } from '../src/domain/teacherBankParse.js';
import { TEACHER_BANK_IMAGES_SAMPLE, TEACHER_BANK_SAMPLE } from './helpers/teacherBankSample.js';

const doc = parseTeacherBankMarkdown(TEACHER_BANK_SAMPLE);

describe('题目.md 结构解析', () => {
  it('头部元信息与小节标题', () => {
    expect(doc.title).toBe('数轴的应用-点的移动');
    expect(doc.meta).toMatchObject({
      subject: '数学',
      version: '人教版 (初中)',
      book: '七年级上册（新）',
      chapter: '第一章 有理数',
      pointId: '11487',
      total: 6,
    });
  });

  it('逐题字段：题型 / 题目标识 / 难度值 / 题干 / 选项 / 答案 / 解析合并', () => {
    const first = doc.questions[0];
    expect(first?.type).toBe('single');
    expect(first?.sourceId).toBe('511916');
    expect(first?.difficulty01).toBeCloseTo(0.64);
    expect(first?.stem).toContain('将点$A$向右移动$3$个单位');
    expect(first?.options).toEqual([
      { no: 0, content: '$-2$' },
      { no: 1, content: '$1$' },
      { no: 2, content: '$2$' },
      { no: 3, content: '$5$' },
    ]);
    expect(first?.answer).toBe('1');
    // 解析 + AI解析合并（AI 解析带小标题）
    expect(first?.analysis).toContain('向右移动用加法');
    expect(first?.analysis).toContain('【AI 解析】');
    expect(first?.thought).toBe('数形结合.');
    expect(first?.method).toBe('画数轴.');
    expect(first?.points).toBe('数轴的三要素.');
  });

  it('多选答案 ACD 编码为下标列表；题号重复不影响后续题', () => {
    expect(doc.questions[1]?.type).toBe('multiple');
    expect(doc.questions[1]?.answer).toBe('0,2,3');
    expect(doc.questions[2]?.sourceId).toBe('511918');
    expect(doc.questions[2]?.answer).toBe('0');
  });

  it('填空多空：；分段、@@ 视为同一空的等价写法、$ 去掉', () => {
    const fill = doc.questions[3];
    expect(fill?.type).toBe('fill');
    expect(fill?.answer).toBe('-\\frac{1}{2}|-0.5；\\frac{1}{2}');
  });

  it('判断题「正确」→ T；难度值低 → 0.2', () => {
    const judge = doc.questions[4];
    expect(judge?.type).toBe('judge');
    expect(judge?.answer).toBe('T');
    expect(judge?.difficulty01).toBeCloseTo(0.2);
  });

  it('未知题型归入简答题并计数', () => {
    const material = doc.questions[5];
    expect(material?.type).toBe('short');
    expect(material?.typeLabel).toBe('材料题');
    expect(doc.unknownTypes).toContain('材料题');
    expect(isKnownTeacherTypeLabel('材料题')).toBe(false);
    expect(isKnownTeacherTypeLabel('单选题')).toBe(true);
  });

  it('题干为空的坏数据整题跳过，不影响其它题', () => {
    expect(doc.questions).toHaveLength(6);
    expect(doc.questions.some((q) => q.sourceId === '511922')).toBe(false);
  });

  it('图片引用跨题干/选项/解析去重并按出现顺序返回', () => {
    const withImages = parseTeacherBankMarkdown(TEACHER_BANK_IMAGES_SAMPLE);
    expect(withImages.questions[0]?.images).toEqual(['images/axis.png', 'images/a.png', 'images/hint.png']);
  });

  it('LaTeX 保留：$…$ 与 \\frac 原样进题干', () => {
    expect(doc.questions[1]?.stem).toContain('负数有');
    expect(doc.questions[3]?.stem).toContain('$\\frac{1}{2}$');
  });

  it('缺难度值 → null；缺解析/思路字段 → 空串', () => {
    expect(doc.questions[3]?.difficulty01).toBeNull();
    expect(doc.questions[2]?.thought).toBe('');
    expect(doc.questions[2]?.points).toBe('');
  });
});
