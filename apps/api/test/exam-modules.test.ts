/**
 * 考试仓储拆分后的纯逻辑单测。
 *
 * 覆盖从 examRepository 各领域模块抽出的纯函数：
 *   - 挑题条件构造：值必须进参数、多选 `__none__` 哨兵、条件顺序不变；
 *   - 分页边界：limit/offset 的默认值与收敛；
 *   - 细目表汇总：知识点 × 题型 × 难度分桶与倒序截断；
 *   - 选题树册次分组：空值 → `__none__`、册次按题量倒序；
 *   - 成绩排序：分数降序 → 用时升序 → id 升序，且不修改入参；
 *   - 成绩单汇总与交卷落库参数：四舍五入口径、布尔 → 0/1 映射。
 */
import { describe, expect, it } from 'vitest';
import {
  attemptInsertParams,
  compareAttemptRank,
  rankAttempts,
  summarizeAttempts,
} from '../src/db/repositories/exam-attempts.js';
import { groupFacetBooks } from '../src/db/repositories/exam-facets.js';
import { buildPickWhere, clampLimit, clampOffset } from '../src/db/repositories/exam-pool-filter.js';
import { summarizeTaxonomy } from '../src/db/repositories/exam-stats.js';
import type { TaxonomyRow } from '../src/db/repositories/exam-stats.js';

describe('挑题条件（纯函数）', () => {
  it('没有条件时不拼 WHERE', () => {
    expect(buildPickWhere({})).toEqual({ where: '', params: [] });
  });

  it('范围/题型/难度/分数区间按原顺序拼接，值全部进参数', () => {
    const { where, params } = buildPickWhere({
      courseId: 3,
      lessonId: 7,
      bankId: 9,
      type: 'single',
      difficulty: 'hard',
      levelMin: 10,
      levelMax: 90,
      exclude: [1, 2],
    });
    expect(where).toBe(
      ' WHERE (q.course_id = ? OR q.bank_lesson_course_id = ? OR q.lesson_id IN (SELECT id FROM lessons WHERE course_id = ?))' +
        ' AND (q.lesson_id = ? OR b.lesson_id = ?) AND q.bank_id = ? AND q.type = ? AND q.difficulty = ?' +
        ' AND q.difficulty_score >= ? AND q.difficulty_score <= ? AND q.id NOT IN (?,?)',
    );
    expect(params).toEqual([3, 3, 3, 7, 7, 9, 'single', 'hard', 10, 90, 1, 2]);
  });

  it('多选是精确 IN + `__none__` 哨兵（匹配空值/NULL），空数组直接省略', () => {
    const { where, params } = buildPickWhere({
      books: ['三年级上册', '__none__'],
      chapters: [''],
      points: ['__none__'],
      types: ['single', 'judge'],
    });
    expect(where).toBe(
      " WHERE (q.book IN (?) OR (q.book IS NULL OR q.book = ''))" +
        " AND (q.point IS NULL OR q.point = '') AND q.type IN (?,?)",
    );
    expect(params).toEqual(['三年级上册', 'single', 'judge']);
  });

  it('难度多选走统一分桶口径，档位值只进参数', () => {
    const { where, params } = buildPickWhere({ levels: ['easy', 'hard'] });
    expect(where).toContain("q.difficulty IN ('easy','medium','hard')");
    expect(where).toContain('q.difficulty_score < 42');
    expect(where.endsWith('IN (?,?)')).toBe(true);
    expect(params).toEqual(['easy', 'hard']);
  });

  it('LIKE 关键字/知识点/章节与带图条件：SQL 文本里不出现用户输入', () => {
    const { where, params } = buildPickWhere({ keyword: '常量', point: '分数', chapter: '第一章', hasImage: true });
    expect(where).not.toContain('常量');
    expect(where).not.toContain('分数');
    expect(where).not.toContain('第一章');
    expect(where.endsWith('AND q.has_image = 1')).toBe(true);
    expect(params).toEqual(['%分数%', '%第一章%', '%常量%']);
  });
});

describe('分页边界（纯函数）', () => {
  it('limit 缺失用默认值，越界收敛到 [1, max]', () => {
    expect(clampLimit(undefined, 20, 400)).toBe(20);
    expect(clampLimit(0, 20, 400)).toBe(1);
    expect(clampLimit(-5, 20, 400)).toBe(1);
    expect(clampLimit(200, 20, 400)).toBe(200);
    expect(clampLimit(999, 20, 400)).toBe(400);
  });

  it('offset 缺失/负数归零，正常值原样保留', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-10)).toBe(0);
    expect(clampOffset(40)).toBe(40);
  });
});

describe('细目表汇总（纯函数）', () => {
  const rows: TaxonomyRow[] = [
    { point: '分数', type: 'single', bucket: 'easy', n: 3 },
    { point: '分数', type: 'single', bucket: 'hard', n: 1 },
    { point: '分数', type: 'multiple', bucket: 'medium', n: 2 },
    { point: '分数', type: 'multiple', bucket: 'unknown', n: 4 },
    { point: '时间', type: 'single', bucket: 'hard', n: 9 },
    { point: '时间', type: 'judge', bucket: 'easy', n: 1 },
  ];

  it('同一知识点 × 题型累加三档，非 easy/hard 一律归 medium', () => {
    const [fraction] = summarizeTaxonomy(rows, 200);
    expect(fraction).toMatchObject({ point: '分数', total: 10 });
    expect(fraction?.cells).toEqual([
      { type: 'single', easy: 3, medium: 0, hard: 1 },
      { type: 'multiple', easy: 0, medium: 6, hard: 0 },
    ]);
  });

  it('知识点按 total 倒序（稳定保留 SQL 顺序），limit 截断知识点数', () => {
    expect(summarizeTaxonomy(rows, 200).map((p) => p.point)).toEqual(['分数', '时间']);
    expect(summarizeTaxonomy(rows, 1).map((p) => [p.point, p.total])).toEqual([['分数', 10]]);
  });

  it('空输入返回空数组', () => {
    expect(summarizeTaxonomy([], 200)).toEqual([]);
  });
});

describe('选题树册次分组（纯函数）', () => {
  it('空册次/空章节映射成 __none__，并给出可读标签与累加题量', () => {
    const books = groupFacetBooks([
      { book: '三年级上册', chapter: '第一章', n: 3 },
      { book: '', chapter: '', n: 2 },
    ]);
    expect(books).toEqual([
      {
        book: '三年级上册',
        label: '三年级上册',
        count: 3,
        chapters: [{ chapter: '第一章', label: '第一章', count: 3 }],
      },
      {
        book: '__none__',
        label: '（未标注册次）',
        count: 2,
        chapters: [{ chapter: '__none__', label: '（未标注章节）', count: 2 }],
      },
    ]);
  });

  it('册次按题量倒序，同册章节保持 SQL 返回顺序', () => {
    const books = groupFacetBooks([
      { book: '三年级上册', chapter: '第一章', n: 3 },
      { book: '三年级上册', chapter: '第二章', n: 4 },
      { book: '四年级下册', chapter: '第一章', n: 10 },
    ]);
    expect(books.map((b) => [b.book, b.count])).toEqual([
      ['四年级下册', 10],
      ['三年级上册', 7],
    ]);
    expect(books[1]?.chapters.map((c) => c.chapter)).toEqual(['第一章', '第二章']);
  });
});

describe('成绩排序规则（纯函数）', () => {
  const rows = [
    { id: 2, score: 80, used_seconds: 100 },
    { id: 1, score: 80, used_seconds: 120 },
    { id: 3, score: 95, used_seconds: 200 },
    { id: 4, score: 80, used_seconds: 100 },
  ];

  it('分数降序 → 用时升序 → id 升序', () => {
    expect(rankAttempts(rows).map((r) => r.id)).toEqual([3, 2, 4, 1]);
    expect(compareAttemptRank(rows[0]!, rows[2]!)).toBeGreaterThan(0);
  });

  it('rankAttempts 返回新数组，不修改入参', () => {
    const before = rows.map((r) => r.id);
    const sorted = rankAttempts(rows);
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('交卷落库参数：answers 序列化成 JSON，passed 布尔映射成 0/1', () => {
    const answers = [{ qid: 3, given: 'A', correct: true, score: 5 }];
    expect(
      attemptInsertParams({
        examId: 1,
        userId: 2,
        answers,
        score: 5,
        total: 10,
        passed: false,
        usedSeconds: 42,
      }),
    ).toEqual([1, 2, JSON.stringify(answers), 5, 10, 0, 42]);
  });
});

describe('成绩单汇总（纯函数）', () => {
  const rows: { score: number; passed: 0 | 1; used_seconds: number }[] = [
    { score: 80, passed: 1, used_seconds: 100 },
    { score: 90, passed: 0, used_seconds: 40 },
    { score: 70, passed: 1, used_seconds: 60 },
  ];

  it('平均分/及格率保留 1 位小数，平均用时取整', () => {
    expect(summarizeAttempts(rows)).toEqual({
      attempts: 3,
      passed: 2,
      pass_rate: 66.7,
      avg: 80,
      best: 90,
      worst: 70,
      avg_seconds: 67,
    });
  });

  it('空成绩单全部为 0（不产生 NaN）', () => {
    expect(summarizeAttempts([])).toEqual({
      attempts: 0,
      passed: 0,
      pass_rate: 0,
      avg: 0,
      best: 0,
      worst: 0,
      avg_seconds: 0,
    });
  });
});
