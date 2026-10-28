/**
 * 题库内「章节 / 小节」筛选与候选项。
 *
 * 后端没有「某题库有哪些章节」的接口，候选只能从题目里汇总：切换题库时后台分页扫描
 * （每页 200 条，最多 10 页）；超大题库只扫前 2000 题，当前页遇到的章节/小节会补进来。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import {
  chapterOptionsOf,
  facetValueOf,
  filterOfFacetValue,
  mergeSectionPairs,
  sectionOptionsOf,
  type SectionPair,
} from '@/utils/question-sections';
import type { QuestionView } from '@/api/types';

interface QuestionPageResponse {
  total: number;
  questions: QuestionView[];
}

/** 候选扫描：每页 200（后端上限），最多 10 页 —— 只用于下拉候选，不用于展示题目 */
const FACET_PAGE_SIZE = 200;
const FACET_MAX_PAGES = 10;

export function useQuestionSections(onFilterChange: () => void) {
  const chapterFilter = ref<string | null>(null);
  const sectionFilter = ref<string | null>(null);
  const pairs = ref<SectionPair[]>([]);
  const facetsLoading = ref(false);
  let loadedBankId: number | null = null;
  let token = 0;

  const chapterOptions = computed(() => chapterOptionsOf(pairs.value));
  const sectionOptions = computed(() => sectionOptionsOf(pairs.value, chapterFilter.value));
  const chapterValue = computed(() => facetValueOf(chapterFilter.value));
  const sectionValue = computed(() => facetValueOf(sectionFilter.value));

  async function fetchPairs(bankId: number): Promise<SectionPair[]> {
    const collected: SectionPair[] = [];
    for (let page = 1; page <= FACET_MAX_PAGES; page += 1) {
      const res = await api.get<QuestionPageResponse>(`/banks/${bankId}/questions`, {
        page,
        pageSize: FACET_PAGE_SIZE,
      });
      for (const question of res.questions) {
        collected.push({ chapter: question.chapter ?? '', section: question.section ?? '' });
      }
      if (res.questions.length < FACET_PAGE_SIZE || collected.length >= res.total) break;
    }
    return collected;
  }

  async function load(bankId: number, force = false): Promise<void> {
    if (!force && loadedBankId === bankId) return;
    const mine = ++token;
    facetsLoading.value = true;
    try {
      const next = await fetchPairs(bankId);
      if (mine !== token) return;
      pairs.value = next;
      loadedBankId = bankId;
    } catch {
      if (mine === token) pairs.value = [];
    } finally {
      if (mine === token) facetsLoading.value = false;
    }
  }

  function resetSectionFilters(): void {
    chapterFilter.value = null;
    sectionFilter.value = null;
  }

  function reset(): void {
    token += 1;
    loadedBankId = null;
    pairs.value = [];
    facetsLoading.value = false;
    resetSectionFilters();
  }

  /** 题库变了：清掉旧候选与筛选，再后台扫描新题库（题库没变时什么都不做） */
  function syncBank(bankId: number | null): void {
    if (bankId === null) {
      reset();
      return;
    }
    if (loadedBankId === bankId) return;
    resetSectionFilters();
    void load(bankId);
  }

  /** 编辑/批量改章节后重新扫描候选 */
  function refresh(): void {
    if (loadedBankId !== null) void load(loadedBankId, true);
  }

  /** 超大题库只扫了前 N 页：把当前页遇到的章节/小节补进候选 */
  function mergeQuestions(questions: QuestionView[]): void {
    if (questions.length === 0) return;
    pairs.value = mergeSectionPairs(
      pairs.value,
      questions.map((question) => ({ chapter: question.chapter ?? '', section: question.section ?? '' })),
    );
  }

  function setChapterFilter(value: string | null): void {
    if (chapterFilter.value === value) return;
    chapterFilter.value = value;
    // 小节候选按章节收敛：换章节时把小节筛选清掉，避免「第一章 + 1.1 节」这种空结果
    sectionFilter.value = null;
    onFilterChange();
  }

  function setSectionFilter(value: string | null): void {
    if (sectionFilter.value === value) return;
    sectionFilter.value = value;
    onFilterChange();
  }

  function onChapterSelect(event: Event): void {
    setChapterFilter(filterOfFacetValue((event.target as HTMLSelectElement).value));
  }

  function onSectionSelect(event: Event): void {
    setSectionFilter(filterOfFacetValue((event.target as HTMLSelectElement).value));
  }

  return {
    chapterFilter,
    sectionFilter,
    chapterOptions,
    sectionOptions,
    chapterValue,
    sectionValue,
    facetsLoading,
    setChapterFilter,
    setSectionFilter,
    onChapterSelect,
    onSectionSelect,
    resetSectionFilters,
    syncBank,
    refresh,
    mergeQuestions,
  };
}
