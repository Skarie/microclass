/**
 * CSV 导入解析（拆自 bankService.importCsv 的纯逻辑）：
 * 表头识别、默认列序、失败行行号与「不阻断其它行」的约定。
 */
import { describe, expect, it } from 'vitest';
import { parseCsvQuestionRows } from '../src/domain/bankImport.js';

describe('CSV 导入解析', () => {
  it('识别表头并按表头列映射解析题目', () => {
    const result = parseCsvQuestionRows([
      ['题型', '题干', '选项A', '选项B', '答案', '解析'],
      ['单选题', 'Java 中定义常量的关键字是？', 'const', 'final', 'B', 'final 修饰的变量为常量'],
      ['判断题', 'Java 是编译型语言。', '', '', '错', ''],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toMatchObject({
      type: 'single',
      stem: 'Java 中定义常量的关键字是？',
      options: ['const', 'final'],
      answer: '1',
      analysis: 'final 修饰的变量为常量',
    });
    expect(result.drafts[1]).toMatchObject({ type: 'judge', answer: 'F' });
  });

  it('没有表头时按导入模板的默认列序从第一行开始解析', () => {
    const result = parseCsvQuestionRows([
      ['简答题', '简述面向对象的三大特性。', '', '', '', '', '', '', '封装、继承、多态', ''],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      type: 'short',
      stem: '简述面向对象的三大特性。',
      answer: '封装、继承、多态',
    });
  });

  it('表头之前的说明行被跳过', () => {
    const result = parseCsvQuestionRows([
      ['微课堂导出'],
      ['题型', '题干', '选项A', '选项B', '答案', '解析'],
      ['简答题', '题干一', '', '', '答案一', ''],
    ]);

    expect(result.errors).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.stem).toBe('题干一');
  });

  it('失败行带 CSV 行号且不影响其它行', () => {
    const result = parseCsvQuestionRows([
      ['题型', '题干', '选项A', '选项B', '答案', '解析'],
      ['单选题', '正常题', 'x', 'y', 'A', ''],
      ['火星题', '坏题', 'x', 'y', 'A', ''],
      ['单选题', '', 'x', 'y', 'A', ''],
    ]);

    expect(result.drafts).toHaveLength(1);
    expect(result.errors).toEqual(['第 3 行: 题型无法识别: "火星题"', '第 4 行: 题干为空']);
  });
});
