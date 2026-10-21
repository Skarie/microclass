/**
 * 题目仓储拆分后的纯逻辑单测。
 *
 * 这些函数从 questionRepository 抽出（查询过滤、分页边界、去重分组、难度分布汇总），
 * 单测锁住三件事：
 *   - LIKE / IN 的值必须进参数，SQL 文本里不出现用户输入；
 *   - 分页/排序口径与拆分前逐字一致；
 *   - 去重「同题不同答案不自动删」、难度分布的排序规则不被改坏。
 */
import { describe, expect, it } from 'vitest';
import { groupDuplicateRows } from '../src/db/repositories/question-dedupe.js';
import type { DuplicateCandidateRow } from '../src/db/repositories/question-dedupe.js';
import {
  buildQuestionFilter,
  buildSearchClauses,
  clampLimit,
  clampOffset,
  placeholders,
} from '../src/db/repositories/question-query.js';
import { summarizeDifficultyRows } from '../src/db/repositories/question-stats.js';
import type { DifficultyLevelRow } from '../src/db/repositories/question-types.js';

describe('题目筛选片段（纯函数）', () => {
  it('没有筛选时不拼 AND 片段', () => {
    expect(buildQuestionFilter()).toEqual({ sql: '', params: [] });
    expect(buildQuestionFilter({})).toEqual({ sql: '', params: [] });
  });

  it('题型/难度/关键字都走占位符，关键字里的 LIKE 通配符只进参数', () => {
    const { sql, params } = buildQuestionFilter({ type: 'single', difficulty: 'hard', keyword: '50%_' });
    expect(sql).toBe(' AND type = ? AND difficulty = ? AND (stem LIKE ? OR analysis LIKE ?)');
    expect(params).toEqual(['single', 'hard', '%50%_%', '%50%_%']);
  });

  it('元数据筛选取值参数化，条件顺序与拆分前一致', () => {
    const { sql, params } = buildQuestionFilter({
      subject: '数学',
      stage: '小学',
      book: '三年级上册',
      chapter: '第一章',
      point: '时间的推算',
    });
    expect(sql).toBe(' AND subject = ? AND stage = ? AND book = ? AND chapter = ? AND point = ?');
    expect(params).toEqual(['数学', '小学', '三年级上册', '第一章', '时间的推算']);
  });

  it('hasImage=true：三条 LIKE 全部参数化，SQL 文本里不出现题图地址片段', () => {
    const { sql, params } = buildQuestionFilter({ hasImage: true });
    expect(sql).toBe(' AND (stem LIKE ? OR options LIKE ? OR analysis LIKE ?)');
    expect(sql).not.toContain('question-media');
    expect(params).toEqual(['%question-media%', '%question-media%', '%question-media%']);
  });

  it('hasImage=false 用 NOT LIKE；mediaOnlyAnalysis 走预计算列', () => {
    const { sql, params } = buildQuestionFilter({ hasImage: false, mediaOnlyAnalysis: true });
    expect(sql).toBe(
      ' AND (stem NOT LIKE ? AND options NOT LIKE ? AND analysis NOT LIKE ?) AND analysis_media_only = 1',
    );
    expect(params).toEqual(['%question-media%', '%question-media%', '%question-media%']);
  });

  it('跨题库检索只参数化值，空值条件直接省略', () => {
    const { sql, params } = buildSearchClauses({ subject: '数学', book: '', point: '分数', limit: 5, offset: 10 });
    expect(sql).toBe(' WHERE q.subject = ? AND q.point = ?');
    expect(params).toEqual(['数学', '分数']);
    expect(buildSearchClauses({})).toEqual({ sql: '', params: [] });
  });
});

describe('分页与占位符边界（纯函数）', () => {
  it('limit 缺失用默认值，越界收敛到 [1, max]', () => {
    expect(clampLimit(undefined, 30, 200)).toBe(30);
    expect(clampLimit(0, 30, 200)).toBe(1);
    expect(clampLimit(-5, 30, 200)).toBe(1);
    expect(clampLimit(50, 30, 200)).toBe(50);
    expect(clampLimit(999, 30, 200)).toBe(200);
  });

  it('offset 缺失/负数归零，正常值原样保留', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-10)).toBe(0);
    expect(clampOffset(40)).toBe(40);
  });

  it('IN 占位符按数量生成，空数组不产出 "()"', () => {
    expect(placeholders(0)).toBe('');
    expect(placeholders(1)).toBe('?');
    expect(placeholders(3)).toBe('?,?,?');
  });
});

describe('重复题分组（纯函数）', () => {
  const rows: DuplicateCandidateRow[] = [
    { content_hash: 'a', id: 1, answer: 'A' },
    { content_hash: 'a', id: 2, answer: 'A' },
    { content_hash: 'b', id: 3, answer: 'x' },
    { content_hash: 'b', id: 4, answer: 'y' },
    { content_hash: 'c', id: 5, answer: 'z' },
    { content_hash: 'c', id: 6, answer: 'z' },
    { content_hash: 'c', id: 7, answer: 'z' },
  ];

  it('同指纹同答案：保留 id 最小的一条，其余进 removeIds', () => {
    expect(groupDuplicateRows(rows, 5000)).toEqual([
      { hash: 'a', keepId: 1, removeIds: [2] },
      { hash: 'c', keepId: 5, removeIds: [6, 7] },
    ]);
  });

  it('同指纹不同答案：整组不自动删（属数据质量问题）', () => {
    const conflict: DuplicateCandidateRow[] = [
      { content_hash: 'b', id: 3, answer: 'x' },
      { content_hash: 'b', id: 4, answer: 'y' },
    ];
    expect(groupDuplicateRows(conflict, 5000)).toEqual([]);
  });

  it('limit 截断的是组数，按首次出现顺序取前面的组', () => {
    expect(groupDuplicateRows(rows, 1)).toEqual([{ hash: 'a', keepId: 1, removeIds: [2] }]);
  });

  it('空输入返回空数组', () => {
    expect(groupDuplicateRows([], 5000)).toEqual([]);
  });
});

describe('难度分布汇总（纯函数）', () => {
  const rows: DifficultyLevelRow[] = [
    { level: 0, source: 'unknown', difficulty: '', bucket: -1, questions: 4 },
    { level: 1, source: 'auto', difficulty: 'easy', bucket: 2, questions: 6 },
    { level: 3, source: 'auto', difficulty: 'medium', bucket: 4, questions: 10 },
    { level: 3, source: 'manual', difficulty: 'medium', bucket: 4, questions: 5 },
    { level: 5, source: 'calibrated', difficulty: 'hard', bucket: 7, questions: 3 },
  ];

  it('总数与未评分（level=0）分开统计', () => {
    const snapshot = summarizeDifficultyRows(rows);
    expect(snapshot.total).toBe(28);
    expect(snapshot.unscored).toBe(4);
  });

  it('三档按题数倒序，同题数保留 SQL 返回顺序', () => {
    expect(summarizeDifficultyRows(rows).buckets).toEqual([
      { difficulty: 'medium', questions: 15 },
      { difficulty: 'easy', questions: 6 },
      { difficulty: '', questions: 4 },
      { difficulty: 'hard', questions: 3 },
    ]);
  });

  it('五级按 level 升序，来源按题数倒序', () => {
    const snapshot = summarizeDifficultyRows(rows);
    expect(snapshot.levels).toEqual([
      { level: 0, questions: 4 },
      { level: 1, questions: 6 },
      { level: 3, questions: 15 },
      { level: 5, questions: 3 },
    ]);
    expect(snapshot.sources).toEqual([
      { source: 'auto', questions: 16 },
      { source: 'manual', questions: 5 },
      { source: 'unknown', questions: 4 },
      { source: 'calibrated', questions: 3 },
    ]);
  });

  it('直方图按 bucket 升序且排除未评分（-1）', () => {
    expect(summarizeDifficultyRows(rows).histogram).toEqual([
      { bucket: 2, questions: 6 },
      { bucket: 4, questions: 15 },
      { bucket: 7, questions: 3 },
    ]);
  });

  it('空输入返回全 0 / 空数组', () => {
    expect(summarizeDifficultyRows([])).toEqual({
      total: 0,
      unscored: 0,
      buckets: [],
      levels: [],
      sources: [],
      histogram: [],
    });
  });
});
