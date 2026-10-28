/**
 * 迁移 0025 的两条解析规则（纯函数）：
 *   - 关联课程 → 年级；未关联课程 → 系列名。
 */
import { describe, expect, it } from 'vitest';
import { parseGrade, parseSeries } from '../src/domain/bankFolderGrouping.js';

describe('课程名 → 年级', () => {
  it('七年级上册 / 初中数学·八年级下册 → 具体年级，不会先命中「初中」', () => {
    expect(parseGrade('七年级上册')).toBe('七年级');
    expect(parseGrade('初中数学·八年级下册')).toBe('八年级');
    expect(parseGrade('小学数学·一年级上册（新）')).toBe('一年级');
    expect(parseGrade('7年级')).toBe('七年级');
  });

  it('必修 / 选择性必修 → 高中；高一/高二/高三保留原样', () => {
    expect(parseGrade('必修1')).toBe('高中');
    expect(parseGrade('高中数学·新必修1')).toBe('高中');
    expect(parseGrade('高中数学·选择性必修2')).toBe('高中');
    expect(parseGrade('高一（上）')).toBe('高一');
    expect(parseGrade('高二数学')).toBe('高二');
    expect(parseGrade('高一年级')).toBe('高一');
    expect(parseGrade('高中一年级')).toBe('高一');
  });

  it('只有学段时返回学段；完全判断不出 → 其他年级', () => {
    expect(parseGrade('初中数学')).toBe('初中');
    expect(parseGrade('小学语文')).toBe('小学');
    expect(parseGrade('火星课程')).toBe('其他年级');
    expect(parseGrade('')).toBe('其他年级');
  });
});

describe('题库名 / 册次 → 系列名', () => {
  it('命中已知词表时返回标准写法', () => {
    expect(parseSeries('黄冈卷')).toBe('黄冈');
    expect(parseSeries('必刷题·第一章')).toBe('必刷题');
    expect(parseSeries('期末冲刺·模拟卷')).toBe('期末冲刺');
    expect(parseSeries('一遍过·考点梳理')).toBe('一遍过');
    expect(parseSeries('初中必刷题七年级上册数学人教版')).toBe('必刷题');
  });

  it('题库名不中时看 book；book 像系列名就取它', () => {
    expect(parseSeries('随堂小测', '单元卷')).toBe('单元卷');
    expect(parseSeries('随堂小测', '期中卷')).toBe('期中卷');
  });

  it('册次不像系列名、也命中不了词表 → 其他资料', () => {
    expect(parseSeries('七年级上册·第一章', '七年级上册')).toBe('其他资料');
    expect(parseSeries('随堂小测', '第一章')).toBe('其他资料');
    expect(parseSeries('', '')).toBe('其他资料');
  });
});
