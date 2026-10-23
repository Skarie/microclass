/**
 * 考试路由的纯逻辑（一）：通用参数解析 —— 多选查询、数字参数、题目 id、
 * 题型/难度配额、难度配比、题型分值、试卷大题结构。
 *
 * 这些规则原先写在 680 行的 routes/exams.ts 里，只能靠整条 HTTP 链路间接验证；
 * 拆成纯函数后直接断言边界（重复参数、非法配额、非数组结构等）。
 */
import { describe, expect, it } from 'vitest';
import {
  hasPositiveQuota,
  isEmptyQuota,
  listParam,
  parseDifficultyQuota,
  parseQuestionIds,
  parseRatio,
  parseScores,
  parseStructureSections,
  parseTypeQuota,
  queryNumber,
} from '../src/domain/examRequest.js';

describe('listParam：多选查询参数', () => {
  it('支持重复参数与逗号分隔，去空白并去重', () => {
    expect(listParam({ points: ['甲,乙', ' 乙 ', '丙'] }, 'points')).toEqual(['甲', '乙', '丙']);
    expect(listParam({ points: '甲, ,甲' }, 'points')).toEqual(['甲']);
    expect(listParam({}, 'points')).toEqual([]);
  });

  it('非字符串值忽略', () => {
    expect(listParam({ points: [1, null, '甲'] }, 'points')).toEqual(['甲']);
  });
});

describe('queryNumber：查询串数字', () => {
  it('只认十进制字符串', () => {
    expect(queryNumber({ page: '3' }, 'page')).toBe(3);
    expect(queryNumber({ page: '' }, 'page')).toBeUndefined();
    expect(queryNumber({ page: 'abc' }, 'page')).toBeUndefined();
    expect(queryNumber({}, 'page')).toBeUndefined();
  });
});

describe('parseQuestionIds：题目 id 列表', () => {
  it('转数字并只保留正数', () => {
    expect(parseQuestionIds(['1', 2, 0, -3, 'x'])).toEqual([1, 2]);
    expect(parseQuestionIds(undefined)).toEqual([]);
    expect(parseQuestionIds('1,2')).toEqual([]);
  });
});

describe('配额 / 配比 / 分值解析', () => {
  it('题型配额只保留白名单键，值转数字', () => {
    expect(parseTypeQuota({ single: '10', judge: 5, bogus: 3 })).toEqual({ single: 10, judge: 5 });
    expect(parseTypeQuota({ single: 'x' })).toEqual({ single: 0 });
    expect(parseTypeQuota(null)).toEqual({});
  });

  it('难度配额：整份非法时 rejected', () => {
    expect(parseDifficultyQuota({ easy: 2, hard: '1' })).toEqual({ quota: { easy: 2, hard: 1 }, rejected: false });
    expect(parseDifficultyQuota({ easy: 0 })).toEqual({ quota: { easy: 0 }, rejected: false });
    expect(parseDifficultyQuota({ easy: 1, x: 2 })).toEqual({ quota: { easy: 1 }, rejected: false });
    expect(parseDifficultyQuota({ foo: 1 })).toEqual({ quota: {}, rejected: true });
    expect(parseDifficultyQuota({})).toEqual({ quota: {}, rejected: false });
    expect(parseDifficultyQuota('easy')).toEqual({ quota: {}, rejected: false });
  });

  it('hasPositiveQuota / isEmptyQuota 的判定口径', () => {
    expect(hasPositiveQuota({ easy: 1, hard: 0 })).toBe(true);
    expect(hasPositiveQuota({ easy: 0, hard: 0 })).toBe(false);
    expect(hasPositiveQuota({})).toBe(false);
    expect(isEmptyQuota({ easy: 0, hard: 0 })).toBe(true);
    expect(isEmptyQuota({ easy: -1 })).toBe(false);
  });

  it('难度配比只保留合法档位', () => {
    expect(parseRatio({ easy: 0.3, medium: '0.5', other: 1 })).toEqual({ easy: 0.3, medium: 0.5 });
    expect(parseRatio(null)).toEqual({});
  });

  it('题型分值丢弃非法数字', () => {
    expect(parseScores({ single: 5, judge: '2', fill: -1, short: 'x' })).toEqual({ single: 5, judge: 2 });
    expect(parseScores(undefined)).toEqual({});
  });

  it('试卷大题结构：非数组为空，缺字段回填', () => {
    expect(parseStructureSections('x')).toEqual([]);
    expect(parseStructureSections([{ name: '一、单选', type: 'single', score: '2' }, { score: 'x' }, null])).toEqual([
      { name: '一、单选', type: 'single', score: 2, description: '' },
      { name: '', type: '', score: 0, description: '' },
      { name: '', type: '', score: 0, description: '' },
    ]);
  });
});
