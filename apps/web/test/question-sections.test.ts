/**
 * 题目章节/小节纯逻辑：筛选候选、筛选值编解码、按章节分组。
 * 这些规则同时被筛选下拉与题目表格使用，错一处两处都会错，所以单独锁住。
 */
import { describe, expect, it } from 'vitest';
import {
  chapterOptionsOf,
  FACET_ALL,
  FACET_NONE,
  facetValueOf,
  filterOfFacetValue,
  groupLabelOf,
  mergeSectionPairs,
  questionGroupsOf,
  sectionOptionsOf,
} from '../src/utils/question-sections';
import type { QuestionView } from '../src/api/types';

function questionOf(id: number, chapter: string, section: string): QuestionView {
  return { id, chapter, section } as QuestionView;
}

describe('章节 / 小节筛选候选', () => {
  const pairs = [
    { chapter: '第一章', section: '1.1' },
    { chapter: '第一章', section: '1.2' },
    { chapter: '第二章', section: '2.1' },
    { chapter: '第一章', section: '1.1' },
    { chapter: '', section: '3.0' },
    { chapter: '', section: '' },
  ];

  it('章节按首次出现顺序去重，空章节不进下拉', () => {
    expect(chapterOptionsOf(pairs)).toEqual(['第一章', '第二章']);
  });

  it('小节在未限定章节时看全库，并去重', () => {
    expect(sectionOptionsOf(pairs, null)).toEqual(['1.1', '1.2', '2.1', '3.0']);
  });

  it('选中具体章节后小节只看该章节；「未分章」只看空章节下的小节', () => {
    expect(sectionOptionsOf(pairs, '第一章')).toEqual(['1.1', '1.2']);
    expect(sectionOptionsOf(pairs, '')).toEqual(['3.0']);
  });

  it('合并候选只补新出现的组合', () => {
    const merged = mergeSectionPairs(
      [{ chapter: '第一章', section: '1.1' }],
      [
        { chapter: '第一章', section: '1.1' },
        { chapter: '第三章', section: '3.1' },
      ],
    );
    expect(merged).toEqual([
      { chapter: '第一章', section: '1.1' },
      { chapter: '第三章', section: '3.1' },
    ]);
  });

  it('筛选值编解码：null=全部，空串=未分章/未分节，避免把两者混在一起', () => {
    expect(facetValueOf(null)).toBe(FACET_ALL);
    expect(facetValueOf('')).toBe(FACET_NONE);
    expect(facetValueOf('第一章')).toBe('第一章');
    expect(filterOfFacetValue(FACET_ALL)).toBeNull();
    expect(filterOfFacetValue(FACET_NONE)).toBe('');
    expect(filterOfFacetValue('第一章')).toBe('第一章');
  });
});

describe('题目按章节分组', () => {
  it('保留首次出现顺序，空章节固定最后并叫「未分章」', () => {
    const groups = questionGroupsOf([
      questionOf(1, '第一章', '1.1'),
      questionOf(2, '', ''),
      questionOf(3, '第二章', '2.1'),
      questionOf(4, '第一章', '1.2'),
    ]);
    expect(groups.map((group) => group.label)).toEqual(['第一章', '第二章', '未分章']);
    expect(groups[0]?.questions.map((question) => question.id)).toEqual([1, 4]);
    expect(groups[2]?.questions.map((question) => question.id)).toEqual([2]);
  });

  it('只有空章节时也单独成组', () => {
    const groups = questionGroupsOf([questionOf(1, '', ''), questionOf(2, '', '1.1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('未分章');
  });

  it('空题目列表返回空分组', () => {
    expect(questionGroupsOf([])).toEqual([]);
  });

  it('分组标题对纯空白章节也按「未分章」处理', () => {
    expect(groupLabelOf('  ')).toBe('未分章');
    expect(groupLabelOf('第一章')).toBe('第一章');
  });
});
