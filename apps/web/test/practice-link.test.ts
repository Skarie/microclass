/**
 * 实践关联的纯展示逻辑：目标匹配、徽标文案、课时页题库标题、题干摘要。
 */
import { describe, expect, it } from 'vitest';
import {
  bankPracticeLink,
  findPracticeLink,
  linkBadge,
  linkMatches,
  practiceBankLabel,
  stemPreview,
  targetLabelOf,
  type PracticeTarget,
} from '../src/utils/practice-link';
import type { PracticeLink } from '../src/api/practice';

function linkOf(partial: Partial<PracticeLink>): PracticeLink {
  return {
    id: 1,
    targetType: 'bank',
    bankId: 3,
    questionId: null,
    chapter: '',
    section: '',
    lessonIds: [12, 13],
    lessons: [
      { id: 12, title: '1.1 认识负数', courseId: 1, courseName: '七年级上册', groupName: '第一章' },
      { id: 13, title: '1.2 有理数', courseId: 1, courseName: '七年级上册', groupName: '第一章' },
    ],
    createdAt: '2026-10-28T00:00:00.000Z',
    ...partial,
  };
}

function targetOf(partial: Partial<PracticeTarget>): PracticeTarget {
  return { type: 'bank', bankId: 3, bankName: '七上数学', chapter: '', section: '', questionId: null, ...partial };
}

describe('关联目标匹配', () => {
  it('整库关联只认 bank 粒度', () => {
    const link = linkOf({});
    expect(linkMatches(link, targetOf({}))).toBe(true);
    expect(linkMatches(link, targetOf({ type: 'chapter', chapter: '第一章' }))).toBe(false);
  });

  it('章节按章节名精确匹配，小节要章节 + 小节都匹配', () => {
    const chapter = linkOf({ targetType: 'chapter', chapter: '第一章' });
    expect(linkMatches(chapter, targetOf({ type: 'chapter', chapter: '第一章' }))).toBe(true);
    expect(linkMatches(chapter, targetOf({ type: 'chapter', chapter: '第二章' }))).toBe(false);

    const section = linkOf({ targetType: 'section', chapter: '第一章', section: '1.1' });
    expect(linkMatches(section, targetOf({ type: 'section', chapter: '第一章', section: '1.1' }))).toBe(true);
    expect(linkMatches(section, targetOf({ type: 'section', chapter: '第一章', section: '1.2' }))).toBe(false);
    expect(linkMatches(section, targetOf({ type: 'chapter', chapter: '第一章' }))).toBe(false);
  });

  it('单题按 questionId 匹配', () => {
    const question = linkOf({ targetType: 'question', questionId: 9 });
    expect(linkMatches(question, targetOf({ type: 'question', questionId: 9 }))).toBe(true);
    expect(linkMatches(question, targetOf({ type: 'question', questionId: 8 }))).toBe(false);
  });

  it('同目标取第一条，整库关联单独取', () => {
    const links = [linkOf({ id: 1 }), linkOf({ id: 2, targetType: 'question', questionId: 9 })];
    expect(findPracticeLink(links, targetOf({}))?.id).toBe(1);
    expect(bankPracticeLink(links)?.id).toBe(1);
    expect(findPracticeLink([links[1]!], targetOf({}))).toBeUndefined();
  });
});

describe('关联徽标与文案', () => {
  it('徽标显示课时数，悬停列出课时名；没有课时不显示', () => {
    expect(linkBadge(linkOf({}))).toEqual({ text: '已关联 2 课时', title: '1.1 认识负数、1.2 有理数' });
    expect(linkBadge(linkOf({ lessonIds: [], lessons: [] }))).toBeNull();
    expect(linkBadge(undefined)).toBeNull();
  });

  it('目标说明按粒度展开题库 / 章节 / 小节 / 单题', () => {
    expect(targetLabelOf(targetOf({}))).toBe('七上数学（整个题库）');
    expect(targetLabelOf(targetOf({ type: 'chapter', chapter: '第一章' }))).toBe('七上数学 · 第一章');
    expect(targetLabelOf(targetOf({ type: 'section', chapter: '第一章', section: '1.1' }))).toBe(
      '七上数学 · 第一章 · 1.1',
    );
    expect(targetLabelOf(targetOf({ type: 'question', questionId: 9, stem: '计算 2+3 的结果' }))).toBe(
      '七上数学 · 单题「计算 2+3 的结果」',
    );
  });

  it('课时页题库名：空章节/小节不显示，非空用 · 连接', () => {
    expect(practiceBankLabel({ name: '七上数学', chapter: '', section: '' })).toBe('七上数学');
    expect(practiceBankLabel({ name: '七上数学', chapter: '第一章', section: '' })).toBe('七上数学 · 第一章');
    expect(practiceBankLabel({ name: '七上数学', chapter: '第一章', section: '1.1' })).toBe('七上数学 · 第一章 · 1.1');
  });

  it('题干摘要去掉图片/链接/HTML 并截断', () => {
    expect(stemPreview('![图](a.png) 计算 <b>2+3</b> 的结果')).toBe('计算 2+3 的结果');
    expect(stemPreview('[点我](https://x.test)', 10)).toBe('点我');
    expect(stemPreview('一'.repeat(80))).toBe(`${'一'.repeat(60)}…`);
  });
});
