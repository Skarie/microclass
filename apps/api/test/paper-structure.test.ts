/**
 * 试卷结构 / 分值折算 / 卷面统计的纯逻辑单测（不建库、不启 Fastify）。
 *
 * 覆盖从 `exam-paper.ts` 抽出后最容易改坏的三处：
 *   ① 结构 JSON 的容错解析与大题默认命名（坏数据不能炸打印/组卷页）；
 *   ② 未填分值时的「总分均摊」折算；
 *   ③ 双向细目表的难度分档、目标配比缺口提示与知识点矩阵排序。
 */
import { describe, expect, it } from 'vitest';
import type { Exam } from '@microclass/shared';
import type { PaperRow } from '../src/services/paperCommon.js';
import { buildBlueprint, fallbackScoreOf, scoreOfRow } from '../src/services/paperBlueprint.js';
import { cnNumber, parseStructure, sectionLabel, TYPE_NAME } from '../src/services/paperStructure.js';

function exam(over: Partial<Exam> = {}): Exam {
  return {
    id: 1,
    course_id: 1,
    title: '单元测试卷',
    description: '',
    duration_minutes: 60,
    pass_score: 60,
    status: 'draft',
    created_at: 0,
    total_score: 100,
    ...over,
  };
}

function row(over: Partial<PaperRow> & { id: number }): PaperRow {
  return {
    bank_id: 1,
    lesson_id: null,
    type: 'single',
    stem: `题目 ${over.id}`,
    image_path: '',
    options: '[]',
    answer: 'A',
    analysis: '',
    sort: 0,
    difficulty: '',
    difficulty_score: -1,
    point: '',
    book: '',
    score: 0,
    section: '',
    ...over,
  };
}

describe('试卷结构解析与命名', () => {
  it('空串 / 非字符串 / 坏 JSON / 非数组都退化成空数组（坏数据不炸接口）', () => {
    expect(parseStructure('')).toEqual([]);
    expect(parseStructure('   ')).toEqual([]);
    expect(parseStructure(null)).toEqual([]);
    expect(parseStructure(42)).toEqual([]);
    expect(parseStructure('{oops')).toEqual([]);
    expect(parseStructure('{"name":"不是数组"}')).toEqual([]);
    expect(parseStructure('null')).toEqual([]);
  });

  it('字段类型不对时逐字段兜底：名称/题型/说明为空串，分值 Number() || 0', () => {
    const raw = JSON.stringify([
      { name: '一、单选题', type: 'single', score: '5', description: '每题 5 分' },
      { name: 123, type: null, score: 'abc', description: false },
      { name: '缺分值' },
    ]);
    expect(parseStructure(raw)).toEqual([
      { name: '一、单选题', type: 'single', score: 5, description: '每题 5 分' },
      { name: '', type: '', score: 0, description: '' },
      { name: '缺分值', type: '', score: 0, description: '' },
    ]);
  });

  it('大题标题：有名称用名称，否则「中文序号、题型名」；未知题型回退原始 type', () => {
    expect(sectionLabel(1, { name: '', type: 'single', score: 2, description: '' })).toBe('一、单选题');
    expect(sectionLabel(2, { name: '二、填空题', type: 'fill', score: 3, description: '' })).toBe('二、填空题');
    expect(sectionLabel(3, { name: '', type: 'essay', score: 0, description: '' })).toBe('三、essay');
    expect(sectionLabel(4, { name: '', type: '', score: 0, description: '' })).toBe('四、');
  });

  it('中文序号：1..10 用汉字，超出范围回退阿拉伯数字', () => {
    expect(cnNumber(1)).toBe('一');
    expect(cnNumber(10)).toBe('十');
    expect(cnNumber(11)).toBe('11');
    expect(TYPE_NAME.short).toBe('简答题');
  });
});

describe('分值折算', () => {
  it('未填分值按「总分 / 题数」均摊，保留 1 位小数', () => {
    expect(fallbackScoreOf(exam({ total_score: 100 }), 4)).toBe(25);
    expect(fallbackScoreOf(exam({ total_score: 90 }), 3)).toBe(30);
    expect(fallbackScoreOf(exam({ total_score: 100 }), 3)).toBeCloseTo(33.3333, 3);
    expect(fallbackScoreOf(exam(), 0)).toBe(0);
    expect(fallbackScoreOf(exam({ total_score: undefined }), 2)).toBe(50);
    expect(scoreOfRow({ score: 0 }, 100 / 3)).toBe(33.3);
    expect(scoreOfRow({ score: 3.5 }, 25)).toBe(3.5);
    expect(scoreOfRow({ score: -1 }, 20)).toBe(20);
  });

  it('统计里未填分值的题用均摊值，填了就用填的值', () => {
    const result = buildBlueprint(exam({ total_score: 90 }), [
      row({ id: 1, score: 5 }),
      row({ id: 2, score: 0 }),
      row({ id: 3, score: 0 }),
    ]);
    expect(result.stats.configuredScore).toBe(65);
    expect(result.stats.averageScorePerQuestion).toBe(30);
    expect(result.stats.questions).toBe(3);
    expect(result.stats.totalScore).toBe(90);
  });
});

describe('双向细目表（buildBlueprint）', () => {
  const rows = [
    row({ id: 1, type: 'single', difficulty: 'easy', difficulty_score: 10, point: '分数', section: '一、单选' }),
    row({ id: 2, type: 'single', difficulty: 'easy', difficulty_score: 20, point: '分数', section: '一、单选' }),
    row({ id: 3, type: 'fill', difficulty: 'medium', difficulty_score: 50, point: '方程', section: '三、填空' }),
    row({
      id: 4,
      type: 'judge',
      difficulty: 'hard',
      difficulty_score: 90,
      point: '',
      section: '',
      image_path: '/api/v1/question-media/a.png',
    }),
  ];

  it('题型 / 难度 / 分值 / 题图 / 预估时长统计正确', () => {
    const result = buildBlueprint(exam({ difficulty_target: '{"easy":0.75,"medium":0.25}' }), rows);
    expect(result.stats.byType).toEqual(
      expect.arrayContaining([
        { type: 'single', count: 2, score: 50 },
        { type: 'fill', count: 1, score: 25 },
        { type: 'judge', count: 1, score: 25 },
      ]),
    );
    expect(result.stats.byDifficulty).toEqual([
      { difficulty: 'easy', count: 2, score: 50 },
      { difficulty: 'hard', count: 1, score: 25 },
      { difficulty: 'medium', count: 1, score: 25 },
    ]);
    expect(result.stats.withImage).toBe(1);
    expect(result.stats.estimatedMinutes).toBe(10);
    // 难度分 → 五级星级：10→1、20→2、50→3、90→5
    expect(result.stats.byLevel).toEqual([
      { level: 1, count: 1 },
      { level: 2, count: 1 },
      { level: 3, count: 1 },
      { level: 5, count: 1 },
    ]);
  });

  it('目标配比差异与缺口提示按题数计算（只提示没配够的档位）', () => {
    const result = buildBlueprint(exam({ difficulty_target: '{"easy":0.75,"medium":0.25}' }), rows);
    expect(result.target.actual).toEqual({ easy: 0.5, medium: 0.25, hard: 0.25 });
    expect(result.target.diff).toEqual({ easy: -0.25, medium: 0 });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toContain('建议再加 1 道');
  });

  it('目标配比坏 JSON 时忽略（不抛错），知识点矩阵按题量倒序且空知识点归并', () => {
    const result = buildBlueprint(exam({ difficulty_target: '{bad' }), rows);
    expect(result.target.ratio).toEqual({});
    expect(result.target.diff).toEqual({});
    expect(result.suggestions).toEqual([]);
    expect(result.matrix.map((m) => m.point)).toEqual(['分数', '方程', '未标知识点']);
    expect(result.matrix[0]).toMatchObject({
      point: '分数',
      total: 2,
      cells: [{ type: 'single', easy: 2, medium: 0, hard: 0 }],
    });
  });

  it('难度档位优先三档字段；没有三档时按难度分 42/71 分档，没分算中档', () => {
    const result = buildBlueprint(exam(), [
      // 三档字段优先于难度分（分数落在 hard 区间也算 easy）
      row({ id: 1, difficulty: 'easy', difficulty_score: 95 }),
      row({ id: 2, difficulty_score: 30 }),
      row({ id: 3, difficulty_score: 60 }),
      row({ id: 4, difficulty_score: 85 }),
      row({ id: 5, difficulty_score: -1 }),
    ]);
    const counts = Object.fromEntries(result.stats.byDifficulty.map((d) => [d.difficulty, d.count]));
    expect(counts).toEqual({ easy: 2, medium: 2, hard: 1 });
    // -1（模型没跑过）按第 3 级；60 分 → 第 4 级；95 / 85 分 → 第 5 级
    expect(result.stats.byLevel).toEqual([
      { level: 2, count: 1 },
      { level: 3, count: 1 },
      { level: 4, count: 1 },
      { level: 5, count: 2 },
    ]);
  });
});
