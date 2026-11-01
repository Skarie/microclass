/**
 * 小节 → 题库匹配规则与难度换算（纯函数，无 IO）。
 */
import { describe, expect, it } from 'vitest';
import {
  difficultyLabelFromScore,
  difficultyScoreFrom01,
  lastBankNameSegment,
  matchTeacherBank,
  teacherBankName,
} from '../src/domain/teacherBankMatch.js';
import type { TeacherBankCandidate } from '../src/domain/teacherBankMatch.js';

const CHAPTER = '第一章 有理数';
const SECTION = '数轴的应用-点的移动';

const bank = (id: number, name: string, section: string): TeacherBankCandidate => ({ id, name, section });

describe('题库名分段', () => {
  it('取 `·` 分隔的最后一段（括号说明不影响）', () => {
    expect(lastBankNameSegment('第一章 有理数（含拓展）· 数轴的应用-点的移动')).toBe('数轴的应用-点的移动');
    expect(lastBankNameSegment('  数轴  ')).toBe('数轴');
    expect(lastBankNameSegment('')).toBe('');
  });

  it('新建题库命名为「章节 · 小节」', () => {
    expect(teacherBankName(CHAPTER, SECTION)).toBe('第一章 有理数 · 数轴的应用-点的移动');
    expect(teacherBankName(CHAPTER, '')).toBe(CHAPTER);
    expect(teacherBankName('', SECTION)).toBe(SECTION);
  });
});

describe('小节 → 题库匹配', () => {
  it('优先：section = 章节 且 题库名最后一段 = 小节', () => {
    const matcher = matchTeacherBank(
      [bank(7, '第一章 有理数 · 数轴', CHAPTER), bank(9, `${CHAPTER} · ${SECTION}`, CHAPTER)],
      CHAPTER,
      SECTION,
    );
    expect(matcher).toEqual({ action: 'replace', bankId: 9, reason: 'section-and-tail' });
  });

  it('章节对不上但题库名末段 = 小节且唯一 → 命中（name-tail）', () => {
    const matcher = matchTeacherBank([bank(3, `拓展训练 · ${SECTION}`, '拓展训练')], CHAPTER, SECTION);
    expect(matcher).toEqual({ action: 'replace', bankId: 3, reason: 'name-tail' });
  });

  it('题库章节为空、名字末段 = 小节 → 命中', () => {
    const matcher = matchTeacherBank([bank(3, `${CHAPTER} · ${SECTION}`, '')], CHAPTER, SECTION);
    expect(matcher).toEqual({ action: 'replace', bankId: 3, reason: 'section-and-tail' });
  });

  it('末段相同但章节都对不上且多条 → 新建（避免把两个小节并进一个题库）', () => {
    const matcher = matchTeacherBank(
      [bank(3, `单元A · ${SECTION}`, '单元A'), bank(4, `单元B · ${SECTION}`, '单元B')],
      CHAPTER,
      SECTION,
    );
    expect(matcher).toEqual({ action: 'create', bankId: null, reason: 'none' });
  });

  it('本次导入已用过的题库不再复用 → 新建（防止覆盖前一个小节）', () => {
    const matcher = matchTeacherBank([bank(3, `${CHAPTER} · ${SECTION}`, CHAPTER)], CHAPTER, SECTION, new Set([3]));
    expect(matcher).toEqual({ action: 'create', bankId: null, reason: 'none' });
  });

  it('没有命中 → 新建', () => {
    expect(matchTeacherBank([bank(3, '别的小节', CHAPTER)], CHAPTER, SECTION)).toEqual({
      action: 'create',
      bankId: null,
      reason: 'none',
    });
    expect(matchTeacherBank([], CHAPTER, SECTION).action).toBe('create');
  });

  it('小节为空时不会误命中任何题库', () => {
    expect(matchTeacherBank([bank(3, CHAPTER, CHAPTER)], CHAPTER, '').action).toBe('create');
  });
});

describe('难度换算（题源难度值≈正确率，越大越基础）', () => {
  it('0~1 → 0~100 分（四舍五入、越大越难）', () => {
    expect(difficultyScoreFrom01(0.64)).toBe(36);
    expect(difficultyScoreFrom01(0.94)).toBe(6);
    expect(difficultyScoreFrom01(0.2)).toBe(80);
    expect(difficultyScoreFrom01(0)).toBe(100);
    expect(difficultyScoreFrom01(1)).toBe(1);
    expect(difficultyScoreFrom01(null)).toBe(-1);
  });

  it('难度分 → 三档（与既有切点一致）', () => {
    expect(difficultyLabelFromScore(36)).toBe('easy');
    expect(difficultyLabelFromScore(60)).toBe('medium');
    expect(difficultyLabelFromScore(80)).toBe('hard');
    expect(difficultyLabelFromScore(-1)).toBe('');
  });
});
