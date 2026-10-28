/**
 * 题目章节 / 小节的纯数据逻辑：筛选下拉的候选、按章节分组、筛选值编解码。
 *
 * 章节 / 小节的候选来自**当前题库的题目**（后端按题目自然序返回，这里只去重、不改顺序）；
 * 分组行把空章节统一叫「未分章」，并固定排在最后一组。
 */
import type { QuestionView } from '@/api/types';

/** 题目上的一对章节/小节（同章节可有多条不同小节） */
export interface SectionPair {
  chapter: string;
  section: string;
}

/** 下拉里的哨兵值：空串是合法筛选值（未分章/未分节），不能拿它表示「全部」 */
export const FACET_ALL = '__all__';
export const FACET_NONE = '__none__';

/** 分组行：同一章节的题目；空章节的 label 是「未分章」 */
export interface QuestionGroup {
  chapter: string;
  label: string;
  questions: QuestionView[];
}

/** 章节候选：按首次出现顺序去重，空章节不进下拉（用「未分章」选项单独表达） */
export function chapterOptionsOf(pairs: SectionPair[]): string[] {
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (pair.chapter.trim() === '') continue;
    seen.add(pair.chapter);
  }
  return [...seen];
}

/**
 * 小节候选：chapter 为 null 时看全库，为空串时只看「未分章」的题，
 * 否则只看该章节下的小节（切换章节后小节下拉不会串味）。
 */
export function sectionOptionsOf(pairs: SectionPair[], chapter: string | null): string[] {
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (chapter !== null && pair.chapter !== chapter) continue;
    if (pair.section.trim() === '') continue;
    seen.add(pair.section);
  }
  return [...seen];
}

/** 合并候选：题库很大、候选只扫了前 N 题时，把当前页遇到的章节/小节补进来 */
export function mergeSectionPairs(base: SectionPair[], extra: SectionPair[]): SectionPair[] {
  const seen = new Set(base.map((pair) => `${pair.chapter}\u0000${pair.section}`));
  const merged = [...base];
  for (const pair of extra) {
    const key = `${pair.chapter}\u0000${pair.section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(pair);
  }
  return merged;
}

/** 筛选值 → <select> 的 value */
export function facetValueOf(filter: string | null): string {
  if (filter === null) return FACET_ALL;
  if (filter === '') return FACET_NONE;
  return filter;
}

/** <select> 的 value → 筛选值（null = 不筛选，空串 = 未分章/未分节） */
export function filterOfFacetValue(value: string): string | null {
  if (value === FACET_ALL) return null;
  if (value === FACET_NONE) return '';
  return value;
}

/** 分组标题：空章节叫「未分章」 */
export function groupLabelOf(chapter: string): string {
  return chapter.trim() === '' ? '未分章' : chapter;
}

/** 按章节分组：保留首次出现顺序，空章节固定放最后 */
export function questionGroupsOf(questions: QuestionView[]): QuestionGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, QuestionView[]>();
  for (const question of questions) {
    const chapter = question.chapter ?? '';
    if (!buckets.has(chapter)) {
      buckets.set(chapter, []);
      order.push(chapter);
    }
    buckets.get(chapter)?.push(question);
  }
  const groups: QuestionGroup[] = [];
  for (const chapter of order) {
    if (chapter.trim() === '') continue;
    groups.push({ chapter, label: groupLabelOf(chapter), questions: buckets.get(chapter) ?? [] });
  }
  const emptyChapter = order.find((chapter) => chapter.trim() === '');
  if (emptyChapter !== undefined) {
    groups.push({
      chapter: emptyChapter,
      label: groupLabelOf(emptyChapter),
      questions: buckets.get(emptyChapter) ?? [],
    });
  }
  return groups;
}
