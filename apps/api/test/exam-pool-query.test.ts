/**
 * 考试路由的纯逻辑（二）：题池 / 选题树 / 知识点 / 细目表的查询参数。
 *
 * 重点覆盖三条容易回归的规则：
 *  - 多选参数与白名单过滤（题型/难度）；
 *  - 默认范围是「本考试所属课程」，只有 scope=all 才跨课程；
 *  - 分页收敛（page ≥ 1、pageSize 1~50）与易错题 minAttempts ≥ 1。
 */
import { describe, expect, it } from 'vitest';
import { parsePoolQuery, poolFiltersFrom } from '../src/domain/examPoolQuery.js';
import { parseFacetsQuery, parsePointsQuery, parseTaxonomyQuery } from '../src/domain/examTaxonomyQuery.js';

describe('poolFiltersFrom：题池多选筛选', () => {
  it('题型/难度按白名单过滤，多选参数支持逗号', () => {
    const filters = poolFiltersFrom({
      courseId: '9',
      types: 'single,bogus,judge',
      levels: 'easy,xxx',
      books: '甲册,乙册',
      chapters: '第一章',
      points: '知识点1,知识点2',
      type: 'fill',
      keyword: '分数',
      hasImage: '1',
      orderBy: 'error_desc',
    });
    expect(filters).toEqual({
      courseId: 9,
      type: 'fill',
      books: ['甲册', '乙册'],
      chapters: ['第一章'],
      points: ['知识点1', '知识点2'],
      types: ['single', 'judge'],
      levels: ['easy'],
      keyword: '分数',
      hasImage: true,
      orderBy: 'error_desc',
    });
  });

  it('hasImage 兼容 0 与布尔，非法排序忽略', () => {
    expect(poolFiltersFrom({ hasImage: '0' })).toEqual({ hasImage: false });
    expect(poolFiltersFrom({ hasImage: true })).toEqual({ hasImage: true });
    expect(poolFiltersFrom({ orderBy: 'bogus' })).toEqual({});
  });
});

describe('parsePoolQuery：题池分页与范围', () => {
  it('默认本考试课程、第 1 页、每页 20、minAttempts=2', () => {
    const parsed = parsePoolQuery({}, 7, []);
    expect(parsed.picks.courseId).toBe(7);
    expect(parsed.picks.exclude).toEqual([]);
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.minAttempts).toBe(2);
    expect(parsed.orderBy).toBeUndefined();
  });

  it('scope=all 不限定课程；显式 courseId 优先', () => {
    expect(parsePoolQuery({ scope: 'all' }, 7, []).picks.courseId).toBeUndefined();
    expect(parsePoolQuery({ courseId: '9' }, 7, []).picks.courseId).toBe(9);
  });

  it('课时/题库/难度分区间/知识点/章节与排除已选题', () => {
    const parsed = parsePoolQuery(
      {
        lessonId: '3',
        bankId: '4',
        difficulty: 'hard',
        levelMin: '70',
        levelMax: '90',
        point: '分数',
        chapter: '第一章',
        excludeInExam: '1',
      },
      7,
      [11, 12],
    );
    expect(parsed.picks).toMatchObject({
      lessonId: 3,
      bankId: 4,
      difficulty: 'hard',
      levelMin: 70,
      levelMax: 90,
      point: '分数',
      chapter: '第一章',
      exclude: [11, 12],
    });
  });

  it('分页收敛：page 最小 1，pageSize 1~50，minAttempts 最小 1', () => {
    const parsed = parsePoolQuery({ page: '0', pageSize: '999', minAttempts: '0' }, 7, []);
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.minAttempts).toBe(1);
  });
});

describe('选题树 / 知识点 / 细目表范围', () => {
  it('facets 默认本课程，排除已选题只在非空时传', () => {
    expect(parseFacetsQuery({}, 7, [])).toEqual({ courseId: 7 });
    expect(parseFacetsQuery({ excludeInExam: '1' }, 7, [11])).toEqual({ courseId: 7, exclude: [11] });
    expect(parseFacetsQuery({ scope: 'all' }, 7, [])).toEqual({});
  });

  it('facets 的题型不过滤白名单，难度过滤白名单', () => {
    expect(parseFacetsQuery({ types: 'single,bogus', levels: 'easy,xxx' }, 7, [])).toEqual({
      courseId: 7,
      types: ['single', 'bogus'],
      levels: ['easy'],
    });
  });

  it('points 带知识点搜索与数量上限', () => {
    expect(
      parsePointsQuery(
        { books: '甲册', chapters: '第一章', pointKeyword: '分数', keyword: '计算', limit: '50' },
        7,
        [],
      ),
    ).toEqual({
      courseId: 7,
      books: ['甲册'],
      chapters: ['第一章'],
      keyword: '计算',
      pointKeyword: '分数',
      limit: 50,
    });
  });

  it('taxonomy 的范围：显式 courseId 优先于 scope', () => {
    expect(parseTaxonomyQuery({}, 7)).toEqual({ scope: 'course', courseId: 7 });
    expect(parseTaxonomyQuery({ scope: 'all' }, 7)).toEqual({ scope: 'all' });
    expect(parseTaxonomyQuery({ scope: 'all', courseId: '9' }, 7)).toEqual({ scope: 'all', courseId: 9 });
    expect(parseTaxonomyQuery({ limit: '10' }, 7)).toEqual({ scope: 'course', courseId: 7, limit: 10 });
  });
});
