/**
 * 题库内题目列表：加载、筛选（题型/难度/关键词/只看配图）、分页与切换题库。
 *
 * 原 660 行单体组合式函数按职责拆成四块：本文件 + use-question-selection（选中与批量）+
 * use-question-editor（编辑器与配图）+ use-question-hotkeys（键盘流与显示偏好）；本文件仍导出
 * useQuestionList，把四块拼成一个返回值，调用方的解构字段不变。
 * 题库选中态与 loadBanks 由参数注入（属于目录组合式函数），本文件不引入全局单例。
 */
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { useQuestionSelection } from '@/composables/use-question-selection';
import { useQuestionEditor } from '@/composables/use-question-editor';
import { useQuestionHotkeys } from '@/composables/use-question-hotkeys';
import { useQuestionSections } from '@/composables/use-question-sections';
import type { Bank, QuestionType, QuestionView } from '@/api/types';

interface QuestionPageResponse {
  total: number;
  page: number;
  pageSize: number;
  questions: QuestionView[];
}
/** 题目列表要用的外部状态：选中题库与刷新题库列表（由目录组合式函数提供） */
export interface QuestionListDeps {
  selectedBankId: Ref<number | null>;
  selectedBank: ComputedRef<Bank | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  /** 隐藏的配图文件输入框（模板里的 ref="qImageInput"） */
  qImageInput: Ref<HTMLInputElement | null>;
}
export function useQuestionList(deps: QuestionListDeps) {
  const toast = useToastStore();
  const questions = ref<QuestionView[]>([]);
  const questionsLoading = ref(false);
  const typeFilter = ref<'' | QuestionType>('');
  const difficultyFilter = ref<'' | 'easy' | 'medium' | 'hard'>('');
  const keyword = ref('');
  /** 只看「解析只有图片」的题（图片里是解析文字：搜不到、改不了，得先把它们找出来） */
  const mediaOnlyFilter = ref(false);
  /** 题组筛选（迁移 0029）：null = 全部；数字 = 只看该题组里、且属于当前题库的题 */
  const groupFilter = ref<number | null>(null);
  /** 题组下拉候选：懒加载（下拉聚焦 / 页面挂载时各拉一次，接口自带 1s 复用） */
  const groupOptions = ref<{ id: number; title: string; total: number }[]>([]);
  /** 「更多筛选」展开开关：低频筛选项默认收起，避免一屏塞三行筛选 */
  const showMoreFilters = ref(false);
  const page = ref(1);
  const total = ref(0);
  const pageSize = ref(20);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

  /** 章节 / 小节筛选与候选：筛选变化后走同一条 search（页码回 1） */
  const sections = useQuestionSections(search);

  /** 关键词**输入即搜**（400ms 防抖）：老师输完习惯直接看结果，不再需要点搜索 */
  let keywordTimer: ReturnType<typeof setTimeout> | undefined;
  watch(keyword, () => {
    if (keywordTimer) clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => {
      page.value = 1;
      void loadQuestions();
    }, 400);
  });
  const selection = useQuestionSelection({
    selectedBankId: deps.selectedBankId,
    questions,
    page,
    loadQuestions,
    loadBanks: deps.loadBanks,
    refreshFacets: sections.refresh,
  });

  const editor = useQuestionEditor({
    selectedBankId: deps.selectedBankId,
    selectedBank: deps.selectedBank,
    qImageInput: deps.qImageInput,
    total,
    loadQuestions,
    loadBanks: deps.loadBanks,
    refreshFacets: sections.refresh,
  });

  const table = useQuestionHotkeys({
    questions,
    openEditQuestion: (question) => editor.openEditQuestion(question),
  });

  async function loadQuestions(): Promise<void> {
    selection.clearSelection();
    table.resetActiveRow();
    const bankId = deps.selectedBankId.value;
    if (bankId === null) {
      questions.value = [];
      total.value = 0;
      return;
    }
    // 切题库时先清掉旧的章节筛选，再拼查询串（否则会带着上一本题库的章节去请求）
    sections.syncBank(bankId);
    questionsLoading.value = true;
    try {
      // 手拼查询串：空串是合法筛选值（?chapter= 表示「未分章」），api.get 的 query 会丢掉空串
      const params = new URLSearchParams();
      if (typeFilter.value) params.set('type', typeFilter.value);
      if (difficultyFilter.value) params.set('difficulty', difficultyFilter.value);
      if (keyword.value.trim()) params.set('keyword', keyword.value.trim());
      if (mediaOnlyFilter.value) params.set('mediaOnlyAnalysis', '1');
      if (groupFilter.value !== null) params.set('groupId', String(groupFilter.value));
      if (sections.chapterFilter.value !== null) params.set('chapter', sections.chapterFilter.value);
      if (sections.sectionFilter.value !== null) params.set('section', sections.sectionFilter.value);
      params.set('page', String(page.value));
      params.set('pageSize', String(pageSize.value));
      const res = await api.get<QuestionPageResponse>(`/banks/${bankId}/questions?${params.toString()}`);
      questions.value = res.questions;
      total.value = res.total;
      page.value = res.page;
      sections.mergeQuestions(res.questions);
    } catch (e) {
      toast.error(errorMessage(e));
      questions.value = [];
      total.value = 0;
    } finally {
      questionsLoading.value = false;
    }
  }

  function clearQuestions(): void {
    questions.value = [];
  }

  function search(): void {
    page.value = 1;
    void loadQuestions();
  }

  function resetFilters(): void {
    keyword.value = '';
    typeFilter.value = '';
    difficultyFilter.value = '';
    mediaOnlyFilter.value = false;
    groupFilter.value = null;
    showMoreFilters.value = false;
    sections.resetSectionFilters();
    search();
  }

  /** 题组下拉候选：题组是跨题库的，和题库选择无关，加载一次即可（写操作会清 GET 缓存） */
  async function loadGroupOptions(): Promise<void> {
    try {
      const res = await api.get<{ groups: { id: number; title: string; total: number }[] }>('/question-groups');
      groupOptions.value = res.groups.map((g) => ({ id: g.id, title: g.title, total: g.total }));
    } catch (e) {
      // 下拉候选加载失败不影响题目列表；下一次聚焦会重试
      toast.error(errorMessage(e));
    }
  }

  /** 下拉的 change 事件：空串 = 全部，其余按数字筛 */
  function onGroupSelect(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    groupFilter.value = raw === '' ? null : Number(raw);
    search();
  }

  /** 体检面板「解析纯图片」点一下 → 左侧题库列表按这个条件筛出来 */
  function showMediaOnlyQuestions(): void {
    mediaOnlyFilter.value = true;
    search();
    void nextTick(() => document.querySelector('.bank-panel__listhead')?.scrollIntoView({ behavior: 'smooth' }));
  }

  function setTypeFilter(value: '' | QuestionType): void {
    typeFilter.value = value;
    search();
  }

  function setDifficultyFilter(value: '' | 'easy' | 'medium' | 'hard'): void {
    difficultyFilter.value = value;
    search();
  }

  function goPage(delta: number): void {
    const next = page.value + delta;
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void loadQuestions();
  }

  function goPageTo(target: number): void {
    page.value = Math.min(Math.max(1, target), totalPages.value);
    void loadQuestions();
  }

  function changePageSize(): void {
    page.value = 1;
    void loadQuestions();
  }

  async function selectBank(bank: Bank): Promise<void> {
    if (deps.selectedBankId.value === bank.id) return;
    deps.selectedBankId.value = bank.id;
    typeFilter.value = '';
    difficultyFilter.value = '';
    keyword.value = '';
    page.value = 1;
    await loadQuestions();
  }

  return {
    questions,
    questionsLoading,
    typeFilter,
    difficultyFilter,
    keyword,
    mediaOnlyFilter,
    groupFilter,
    groupOptions,
    loadGroupOptions,
    onGroupSelect,
    showMoreFilters,
    page,
    total,
    pageSize,
    totalPages,
    loadQuestions,
    clearQuestions,
    search,
    resetFilters,
    showMediaOnlyQuestions,
    setTypeFilter,
    setDifficultyFilter,
    goPage,
    goPageTo,
    changePageSize,
    selectBank,
    ...table,
    ...sections,
    ...selection,
    ...editor,
  };
}
