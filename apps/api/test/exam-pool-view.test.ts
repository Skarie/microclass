/**
 * 考试路由的纯逻辑（三）：题池响应拼装。
 *
 * 易错题榜单的规则最容易回归：过滤样本不足、按威尔逊下界排序（同分按作答量），
 * 以及分页信封里的 total 必须是「过滤后、分页前」的总数。
 */
import { describe, expect, it } from 'vitest';
import {
  buildErrorPoolPage,
  buildPoolQuestions,
  poolQuestionView,
  type ErrorStat,
  type PoolRow,
} from '../src/domain/examPoolView.js';

const row = (id: number, override: Partial<PoolRow> = {}): PoolRow => ({
  id,
  stem: `题干${id}`,
  type: 'single',
  bank_id: 1,
  bank_name: '题库',
  point: '知识点',
  book: '一年级下册',
  difficulty: 'easy',
  difficulty_score: 30,
  ...override,
});

const stat = (attempts: number, wrong: number, score: number): ErrorStat => ({
  attempts,
  wrong,
  rate: attempts > 0 ? wrong / attempts : 0,
  score,
});

describe('题池响应拼装', () => {
  it('没有作答数据时错率按 0 返回', () => {
    expect(poolQuestionView(row(1))).toEqual({
      id: 1,
      stem: '题干1',
      type: 'single',
      bank_id: 1,
      bank_name: '题库',
      point: '知识点',
      book: '一年级下册',
      difficulty: 'easy',
      difficulty_score: 30,
      attempts: 0,
      wrong: 0,
      error_rate: 0,
      error_score: 0,
    });
  });

  it('错率保留三位小数', () => {
    const view = poolQuestionView(row(2), stat(3, 1, 0.1));
    expect(view.attempts).toBe(3);
    expect(view.wrong).toBe(1);
    expect(view.error_rate).toBe(0.333);
  });

  it('普通模式按查询顺序拼装', () => {
    const list = buildPoolQuestions([row(2), row(1)], new Map([[1, stat(2, 1, 0.5)]]));
    expect(list.map((q) => q.id)).toEqual([2, 1]);
    expect(list[1]?.attempts).toBe(2);
  });

  it('易错题模式：过滤样本不足，按威尔逊下界降序、同分按作答量降序', () => {
    const rows = [row(1), row(2), row(3), row(4)];
    const stats = new Map<number, ErrorStat>([
      [1, stat(2, 1, 0.2)], // 样本够
      [2, stat(1, 1, 0.9)], // 样本不足（minAttempts=2）
      [3, stat(10, 6, 0.45)], // 证据足且分最高
      [4, stat(5, 0, 0)], // 全对
    ]);
    const page = buildErrorPoolPage(rows, stats, { minAttempts: 2, page: 1, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.questions.map((q) => q.id)).toEqual([3, 1]);
  });

  it('易错题模式分页：total 是过滤后总数，questions 按页切片', () => {
    const rows = [row(1), row(2), row(3)];
    const stats = new Map<number, ErrorStat>([
      [1, stat(5, 3, 0.4)],
      [2, stat(5, 2, 0.3)],
      [3, stat(5, 1, 0.2)],
    ]);
    const page = buildErrorPoolPage(rows, stats, { minAttempts: 1, page: 2, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.questions.map((q) => q.id)).toEqual([3]);
  });
});
