/**
 * 组卷取数纯逻辑单测：抽题配额分配、范围查询拼装、难度回退与平行卷配对。
 *
 * 这些规则原先埋在 `exam-paper.ts` 的长函数里，拆分后单独验证：
 * 任何一条退化成「忽略范围 / 忽略难度 / 平行卷配到同一道题」都会在这里被挡住。
 */
import { describe, expect, it } from 'vitest';
import type { AuditRepository } from '../src/db/repositories/auditRepository.js';
import type { ExamRepository } from '../src/db/repositories/examRepository.js';
import type { QuestionRepository } from '../src/db/repositories/questionRepository.js';
import type { ExamPaperDeps } from '../src/services/paperCommon.js';
import { pickParallelCandidate, type ParallelCandidate } from '../src/services/paperParallel.js';
import { allocateDifficultyBuckets, positiveEntries } from '../src/services/paperQuota.js';
import {
  composePickAttempts,
  composeScopeQuery,
  levelBucketOf,
  levelRangeOf,
  pickForCompose,
  type PickQuery,
} from '../src/services/paperRange.js';

function depsWithPick(pick: (query: PickQuery) => { id: number }[]): ExamPaperDeps {
  return {
    exams: { pick } as unknown as ExamRepository,
    questions: {} as unknown as QuestionRepository,
    audit: {} as unknown as AuditRepository,
  };
}

describe('难度档位与难度分区间', () => {
  it('五级难度星级映射到三档；超出五级时退回旧的三档字段', () => {
    expect(levelBucketOf({ difficulty_level: 1 })).toBe('easy');
    expect(levelBucketOf({ difficulty_level: 2 })).toBe('easy');
    expect(levelBucketOf({ difficulty_level: 3 })).toBe('medium');
    expect(levelBucketOf({ difficulty_level: 4 })).toBe('hard');
    expect(levelBucketOf({ difficulty_level: 5 })).toBe('hard');
    expect(levelBucketOf({ difficulty_level: 0, difficulty: 'hard' })).toBe('hard');
    expect(levelBucketOf({ difficulty_level: 9, difficulty: 'easy' })).toBe('easy');
    expect(levelBucketOf({})).toBe('medium');
  });

  it('难度分区间与题库口径一致：易 0–42 / 中 42–71 / 难 71–100', () => {
    expect(levelRangeOf('easy')).toEqual({ levelMin: 0, levelMax: 42 });
    expect(levelRangeOf('medium')).toEqual({ levelMin: 42, levelMax: 71 });
    expect(levelRangeOf('hard')).toEqual({ levelMin: 71, levelMax: 100 });
    expect(levelRangeOf(undefined)).toEqual({});
  });
});

describe('抽题配额分配', () => {
  it('题型内按难度配比拆分名额，总数恰好等于需求数', () => {
    expect(allocateDifficultyBuckets(10, { easy: 0.3, medium: 0.5, hard: 0.2 })).toEqual([
      'easy',
      'easy',
      'easy',
      'medium',
      'medium',
      'medium',
      'medium',
      'medium',
      'hard',
      'hard',
    ]);
  });

  it('配比没铺满时补中档；超出时截断；0 道就是空', () => {
    expect(allocateDifficultyBuckets(5, { easy: 0.1 })).toEqual(['easy', 'medium', 'medium', 'medium', 'medium']);
    expect(allocateDifficultyBuckets(3, { easy: 1, hard: 1 })).toEqual(['easy', 'easy', 'easy']);
    expect(allocateDifficultyBuckets(0, {})).toEqual([]);
  });

  it('配额只保留数量 > 0 的项，且保持传入顺序', () => {
    expect(positiveEntries({ single: 2, multiple: 0, judge: -1, fill: undefined })).toEqual([
      { key: 'single', count: 2 },
    ]);
    expect(positiveEntries({ easy: 1.5, hard: 0 })).toEqual([{ key: 'easy', count: 1.5 }]);
    expect(positiveEntries(undefined)).toEqual([]);
  });
});

describe('组卷范围查询拼装', () => {
  it('课程 / 章节 / 知识点 / 多选范围全部带进查询，limit 固定 30', () => {
    const query = composeScopeQuery({
      type: 'single',
      courseId: 3,
      point: '分数',
      chapter: '第一章',
      books: ['三年级上册'],
      chapters: ['第一章'],
      points: ['分数'],
      exclude: [1, 2],
    });
    expect(query).toMatchObject({
      type: 'single',
      courseId: 3,
      point: '分数',
      chapter: '第一章',
      books: ['三年级上册'],
      chapters: ['第一章'],
      points: ['分数'],
      exclude: [1, 2],
      limit: 30,
    });
  });

  it('没传的课程 / 空的多选范围不写进查询（避免 undefined 被当成"不限范围"）', () => {
    const bare = composeScopeQuery({ type: 'judge', books: [], chapters: [], points: [], exclude: [] });
    expect('courseId' in bare).toBe(false);
    expect('books' in bare).toBe(false);
    expect('chapters' in bare).toBe(false);
    expect('points' in bare).toBe(false);
    expect('point' in bare).toBe(false);
    expect('chapter' in bare).toBe(false);
  });

  it('有难度档时三次回退：难度分区间 → 旧三档字段 → 只保题型范围', () => {
    const attempts = composePickAttempts({ type: 'single', level: 'medium', exclude: [1] });
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toMatchObject({ type: 'single', levelMin: 42, levelMax: 71, exclude: [1] });
    expect(attempts[1]).toMatchObject({ type: 'single', difficulty: 'medium', exclude: [1] });
    expect(attempts[2]?.levelMin).toBeUndefined();
    expect(attempts[2]?.difficulty).toBeUndefined();
    // 没给难度档时第一次与最后一次是同一条件（历史行为：多查一次同样的题池，不影响结果）
    expect(composePickAttempts({ type: 'single', exclude: [] })).toHaveLength(2);
  });

  it('挑题按回退顺序取第一个非空结果（前两次空才降到只保题型）', () => {
    const calls: PickQuery[] = [];
    const deps = depsWithPick((query) => {
      calls.push(query);
      return calls.length === 2 ? [{ id: 7 }] : [];
    });
    expect(pickForCompose(deps, { type: 'single', level: 'hard', exclude: [] })).toBe(7);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.levelMin).toBe(71);
    expect(calls[1]?.difficulty).toBe('hard');
  });

  it('题池全空时返回 undefined（调用方据此报缺口，不硬凑）', () => {
    const calls: PickQuery[] = [];
    const deps = depsWithPick((query) => {
      calls.push(query);
      return [];
    });
    expect(pickForCompose(deps, { type: 'fill', level: 'easy', exclude: [] })).toBeUndefined();
    expect(calls).toHaveLength(3);
  });
});

describe('平行卷逐题配对', () => {
  const pool: ParallelCandidate[] = [
    { id: 1, point: '分数', difficulty: 'easy' },
    { id: 2, point: '方程', difficulty: 'easy' },
    { id: 3, point: '分数', difficulty: 'hard' },
    { id: 4, point: '方程', difficulty: 'hard' },
  ];

  it('优先级：同知识点+同难度 → 同知识点 → 同难度 → 任意题', () => {
    expect(pickParallelCandidate(pool, new Set(), { point: '分数', level: 'easy' })?.id).toBe(1);
    // 同知识点但难度不同，仍优先于"只同难度"
    expect(pickParallelCandidate(pool, new Set([1]), { point: '分数', level: 'easy' })?.id).toBe(3);
    // 没有同知识点，退到同难度
    expect(pickParallelCandidate(pool, new Set([1, 3]), { point: '几何', level: 'hard' })?.id).toBe(4);
    // 什么都不匹配时取任意未用题
    expect(pickParallelCandidate(pool, new Set([1, 3, 4]), { point: '几何', level: 'medium' })?.id).toBe(2);
  });

  it('已用过的候选不会再被配上；题池耗尽返回 undefined', () => {
    expect(pickParallelCandidate(pool, new Set([1, 2, 3, 4]), { point: '分数', level: 'easy' })).toBeUndefined();
  });
});
