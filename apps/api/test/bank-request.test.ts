/**
 * 题库路由的纯逻辑（一）：查询参数解析。
 *
 * 这些规则原先写在 550 行的 `routes/banks.ts` 里，只能靠整条 HTTP 链路间接验证；
 * 拆成纯函数后直接断言边界：默认分页、`orphan`/`unbound` 哨兵、非法值的 400 文案、
 * 体检 limit 收敛、空值条件省略。测试同时锁住请求体 schema 的字段，
 * 防止再出现「schema 漏声明 → 被 removeAdditional 静默丢掉」的老问题。
 */
import { describe, expect, it } from 'vitest';
import {
  parseBankCatalogQuery,
  parseBankHealthQuery,
  parseBankKind,
  parseBankListQuery,
  parseBankQuestionListQuery,
  parseQuestionSearchQuery,
  withAnswersFlag,
} from '../src/routes/bankQuery.js';
import { bankBodySchema, questionBodySchema } from '../src/routes/banks-shared.js';

/** 断言抛出 400 且文案一致（AppError.status） */
function expectBadRequest(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toMatchObject({ status: 400, message });
    return;
  }
  throw new Error(`expected 400: ${message}`);
}

describe('parseBankKind：题库类型筛选', () => {
  it('合法类型原样返回，空值表示全部', () => {
    expect(parseBankKind('lesson')).toBe('lesson');
    expect(parseBankKind('chapter')).toBe('chapter');
    expect(parseBankKind('paper')).toBe('paper');
    expect(parseBankKind(undefined)).toBe('');
    expect(parseBankKind('')).toBe('');
  });

  it('非法类型直接 400（不静默忽略筛选）', () => {
    expectBadRequest(() => parseBankKind('exam'), 'kind 只能是 lesson/chapter/paper');
  });
});

describe('parseBankListQuery：题库列表筛选 + 分页', () => {
  it('不传参数时默认取前 300 条、offset 0', () => {
    expect(parseBankListQuery({})).toEqual({ limit: 300, offset: 0 });
  });

  it('lesson / courseId 的 orphan / unbound 哨兵映射成 null', () => {
    expect(parseBankListQuery({ lesson: 'orphan', courseId: 'unbound' })).toMatchObject({
      lessonId: null,
      courseId: null,
    });
  });

  it('正常筛选值原样进入 filter（kind 走白名单校验）', () => {
    expect(
      parseBankListQuery({
        lesson: '7',
        kind: 'chapter',
        subject: '数学',
        book: '三年级上册',
        keyword: '分数',
        courseId: '3',
        limit: '50',
        offset: '100',
      }),
    ).toEqual({
      lessonId: 7,
      kind: 'chapter',
      subject: '数学',
      book: '三年级上册',
      keyword: '分数',
      courseId: 3,
      limit: 50,
      offset: 100,
    });
  });

  it('空串筛选值等于没传（只有分页仍给默认值）', () => {
    expect(parseBankListQuery({ lesson: '', kind: '', subject: '', courseId: '', limit: '', offset: '' })).toEqual({
      limit: 300,
      offset: 0,
    });
  });

  it('非法数字参数报 400（lesson / courseId / limit / offset）', () => {
    expectBadRequest(() => parseBankListQuery({ lesson: 'abc' }), 'lesson 参数非法');
    expectBadRequest(() => parseBankListQuery({ courseId: 'abc' }), 'courseId 参数非法');
    expectBadRequest(() => parseBankListQuery({ limit: 'abc' }), 'limit 参数非法');
    expectBadRequest(() => parseBankListQuery({ limit: '0' }), 'limit 参数非法');
    expectBadRequest(() => parseBankListQuery({ offset: '-1' }), 'offset 参数非法');
  });
});

describe('parseBankCatalogQuery / parseBankHealthQuery', () => {
  it('目录：kind 先校验，courseId 只认数字', () => {
    expect(parseBankCatalogQuery({})).toEqual({ kind: '' });
    expect(parseBankCatalogQuery({ kind: 'paper' })).toEqual({ kind: 'paper' });
    expect(parseBankCatalogQuery({ courseId: '9', kind: 'paper' })).toEqual({ courseId: 9, kind: 'paper' });
    expectBadRequest(() => parseBankCatalogQuery({ kind: 'exam' }), 'kind 只能是 lesson/chapter/paper');
    expectBadRequest(() => parseBankCatalogQuery({ courseId: 'x' }), 'courseId 参数非法');
  });

  it('体检：默认 limit 20，bankId 可选，refresh 只在 refresh=1 时为 true', () => {
    expect(parseBankHealthQuery({})).toEqual({ bankId: undefined, limit: 20, refresh: false });
    expect(parseBankHealthQuery({ bankId: '5', refresh: '1' })).toEqual({ bankId: 5, limit: 20, refresh: true });
    expect(parseBankHealthQuery({ refresh: '0' })).toMatchObject({ refresh: false });
  });

  it('体检 limit 收敛到 1~100，bankId 空串保留拆分前的 400', () => {
    expect(parseBankHealthQuery({ limit: '0' }).limit).toBe(1);
    expect(parseBankHealthQuery({ limit: '500' }).limit).toBe(100);
    expect(parseBankHealthQuery({ limit: '30' }).limit).toBe(30);
    expectBadRequest(() => parseBankHealthQuery({ bankId: 'abc' }), 'bankId 参数非法');
    expectBadRequest(() => parseBankHealthQuery({ bankId: '' }), 'bankId 参数非法');
  });
});

describe('题目列表 / 跨库检索参数', () => {
  it('题库内题目列表：空筛选省略，mediaOnlyAnalysis=1 变成布尔', () => {
    expect(parseBankQuestionListQuery({})).toEqual({});
    expect(parseBankQuestionListQuery({ type: 'single', difficulty: 'hard', keyword: '分数' })).toEqual({
      type: 'single',
      difficulty: 'hard',
      keyword: '分数',
    });
    expect(parseBankQuestionListQuery({ mediaOnlyAnalysis: '1', page: '2', pageSize: '50' })).toEqual({
      mediaOnlyAnalysis: true,
      page: 2,
      pageSize: 50,
    });
    expect(parseBankQuestionListQuery({ mediaOnlyAnalysis: '0' })).toEqual({});
  });

  it('跨库检索：只保留传了的条件，页码转数字', () => {
    expect(parseQuestionSearchQuery({})).toEqual({});
    expect(
      parseQuestionSearchQuery({
        subject: '数学',
        book: '三年级上册',
        chapter: '第一章',
        point: '分数',
        difficulty: 'easy',
        type: 'single',
        page: '3',
        pageSize: '20',
      }),
    ).toEqual({
      subject: '数学',
      book: '三年级上册',
      chapter: '第一章',
      point: '分数',
      difficulty: 'easy',
      type: 'single',
      page: 3,
      pageSize: 20,
    });
    expect(parseQuestionSearchQuery({ subject: '', page: '' })).toEqual({});
  });

  it('导出参数：只有 answers=0 关闭答案，其余都带答案', () => {
    expect(withAnswersFlag(undefined)).toBe(true);
    expect(withAnswersFlag('')).toBe(true);
    expect(withAnswersFlag('1')).toBe(true);
    expect(withAnswersFlag('0')).toBe(false);
  });
});

describe('请求体 schema（防止字段漏声明被静默丢掉）', () => {
  it('题目 schema 声明难度与标准化元数据，且仍禁止额外字段', () => {
    expect(questionBodySchema.additionalProperties).toBe(false);
    expect(Object.keys(questionBodySchema.properties)).toEqual(
      expect.arrayContaining(['difficulty', 'subject', 'stage', 'book', 'chapter', 'point']),
    );
    expect(questionBodySchema.properties.difficulty.enum).toEqual(['', 'easy', 'medium', 'hard']);
  });

  it('题库 schema 声明类型 / 学科 / 册次 / 归属课程', () => {
    expect(bankBodySchema.additionalProperties).toBe(false);
    expect(Object.keys(bankBodySchema.properties)).toEqual(
      expect.arrayContaining(['name', 'lessonId', 'kind', 'subject', 'book', 'courseId']),
    );
    expect(bankBodySchema.properties.kind.enum).toEqual(['lesson', 'chapter', 'paper', '']);
  });
});
