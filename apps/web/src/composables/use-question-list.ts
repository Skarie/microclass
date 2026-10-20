/**
 * 题库内题目列表：加载、筛选、分页、多选、键盘流、题干展开与题目编辑器。
 *
 * 从 BankAdminView 抽出。题库选中态与 loadBanks 由参数注入（属于目录组合式函数），
 * 本文件只持有题目相关状态，不引入全局单例。
 */
import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { difficultyLabel, difficultySourceLabel } from '@/composables/difficulty';
import type { Bank, QuestionType, QuestionView } from '@/api/types';

interface QuestionPageResponse {
  total: number;
  page: number;
  pageSize: number;
  questions: QuestionView[];
}

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface ImageResponse {
  ok: boolean;
  imagePath: string;
}

/** 选项草稿：用对象包裹，避免下标访问在 strict 下的 undefined 噪音 */
interface OptionDraft {
  text: string;
}

/** 题目编辑表单的字段契约（与 QuestionEditor 的 props 对齐） */
interface QuestionFormDraft {
  type: QuestionType;
  stem: string;
  options: OptionDraft[];
  singleAnswer: number;
  multipleAnswer: number[];
  judgeAnswer: string;
  textAnswer: string;
  analysis: string;
  sort: number;
  difficulty: string;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * 题库管理显示偏好（localStorage 记住）：
 *   行密度 与 是否显示题目元信息 —— 老师审题喜欢紧凑、录题喜欢信息全，两种人都要照顾。
 */
const PREFS_KEY = 'mc.bank.prefs';

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

  /* ---------------- 题目列表 ---------------- */
  const questions = ref<QuestionView[]>([]);
  const questionsLoading = ref(false);
  const typeFilter = ref<'' | QuestionType>('');
  const difficultyFilter = ref<'' | 'easy' | 'medium' | 'hard'>('');
  const keyword = ref('');
  /** 只看「解析只有图片」的题（图片里是解析文字：搜不到、改不了，得先把它们找出来） */
  const mediaOnlyFilter = ref(false);
  /** 「更多筛选」展开开关：低频筛选项默认收起，避免一屏塞三行筛选 */
  const showMoreFilters = ref(false);
  const page = ref(1);
  const total = ref(0);

  /**
   * 关键词**输入即搜**（400ms 防抖）。
   * 原来要手动点"搜索"按钮：老师输完习惯性回车/直接看结果，容易以为没搜到。
   */
  let keywordTimer: ReturnType<typeof setTimeout> | undefined;
  watch(keyword, () => {
    if (keywordTimer) clearTimeout(keywordTimer);
    keywordTimer = setTimeout(() => {
      page.value = 1;
      void loadQuestions();
    }, 400);
  });

  /** 每页条数：老师看 100 条/页很常见，给 20/50/100 三档 */
  const pageSize = ref(DEFAULT_PAGE_SIZE);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

  function goPageTo(target: number): void {
    page.value = Math.min(Math.max(1, target), totalPages.value);
    void loadQuestions();
  }

  function changePageSize(): void {
    page.value = 1;
    void loadQuestions();
  }

  /** 题型/难度筛选（chip 组用）：设值后立即查询 */
  function setTypeFilter(value: '' | QuestionType): void {
    typeFilter.value = value;
    search();
  }

  function setDifficultyFilter(value: '' | 'easy' | 'medium' | 'hard'): void {
    difficultyFilter.value = value;
    search();
  }

  /** 悬停看细节：评分 / 来源 / 样本数（原来直接堆在行里，太吵） */
  function difficultyTitle(question: {
    difficulty?: string | null;
    difficulty_score?: number | null;
    difficulty_source?: string | null;
    difficulty_n?: number | null;
  }): string {
    const parts = [`难度 ${difficultyLabel(question.difficulty)}`];
    if ((question.difficulty_score ?? -1) > 0) parts.push(`${Math.round(question.difficulty_score ?? 0)}/100`);
    if (question.difficulty_source) parts.push(difficultySourceLabel(question.difficulty_source));
    if (question.difficulty_n) parts.push(`${question.difficulty_n} 次作答`);
    return parts.join(' · ');
  }

  const DIFFICULTY_OPTIONS: { value: 'easy' | 'medium' | 'hard'; label: string }[] = [
    { value: 'easy', label: '基础' },
    { value: 'medium', label: '中等' },
    { value: 'hard', label: '较难' },
  ];

  /** 多选：当前页选中的题目 id */
  const selectedIds = ref<Set<number>>(new Set());
  const selectedCount = computed(() => selectedIds.value.size);
  const allOnPageSelected = computed(
    () => questions.value.length > 0 && questions.value.every((q) => selectedIds.value.has(q.id)),
  );
  function toggleSelect(id: number): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }
  function toggleSelectAllOnPage(): void {
    if (allOnPageSelected.value) {
      selectedIds.value = new Set();
      return;
    }
    selectedIds.value = new Set(questions.value.map((q) => q.id));
  }
  function clearSelection(): void {
    if (selectedIds.value.size > 0) selectedIds.value = new Set();
  }

  /** 批量改难度的菜单项（复用题型的难度档位定义） */
  const bulkDifficultyItems = DIFFICULTY_OPTIONS.map((d) => ({ key: d.value, label: d.label }));

  const bulkBusy = ref(false);

  /** 批量改难度：人工标注（重算难度不会覆盖），一次请求处理一页以内 */
  async function bulkSetDifficulty(difficulty: 'easy' | 'medium' | 'hard'): Promise<void> {
    const bankId = deps.selectedBankId.value;
    const ids = [...selectedIds.value];
    if (bankId === null || ids.length === 0) return;
    bulkBusy.value = true;
    try {
      const res = await api.post<{ updated: number; skipped: number }>(`/banks/${bankId}/questions/bulk-difficulty`, {
        ids,
        difficulty,
      });
      toast.success(`已把 ${res.updated} 道题标为「${difficultyLabel(difficulty)}」`);
      clearSelection();
      await loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulkBusy.value = false;
    }
  }

  /** 批量删除：不可恢复，二次确认 */
  async function bulkDelete(): Promise<void> {
    const bankId = deps.selectedBankId.value;
    const ids = [...selectedIds.value];
    if (bankId === null || ids.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 道题吗？删除后不可恢复。`)) return;
    bulkBusy.value = true;
    try {
      const res = await api.post<{ deleted: number; skipped: number }>(`/banks/${bankId}/questions/bulk-delete`, {
        ids,
      });
      toast.success(`已删除 ${res.deleted} 道题`);
      clearSelection();
      await loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulkBusy.value = false;
    }
  }

  /** 题干是否默认折叠（长题干限 3 行，点一下展开）：一屏能多看几道题 */
  const expandedStems = ref<Set<number>>(new Set());
  function isStemExpanded(id: number): boolean {
    return expandedStems.value.has(id);
  }
  function toggleStem(id: number): void {
    const next = new Set(expandedStems.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedStems.value = next;
  }

  /** 表格容器引用：点表格任意处让它获得焦点，↑↓ 就能直接用 */
  const tableWrap = ref<HTMLElement | null>(null);

  /** 键盘流：当前高亮的题目下标（-1 = 未选） */
  const activeRow = ref(-1);
  /** 搜索框引用：按 "/" 直接聚焦 */
  const keywordInput = ref<HTMLInputElement | null>(null);

  function onTableKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (typing && event.key !== 'Escape') return;
    const count = questions.value.length;
    if (count === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeRow.value = activeRow.value < 0 ? 0 : Math.min(count - 1, activeRow.value + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeRow.value = activeRow.value <= 0 ? 0 : activeRow.value - 1;
      return;
    }
    if (event.key === 'Enter' && activeRow.value >= 0) {
      event.preventDefault();
      const row = questions.value[activeRow.value];
      if (row) openEditQuestion(row);
      return;
    }
    if (event.key === 'Escape') activeRow.value = -1;
  }

  async function loadQuestions(): Promise<void> {
    clearSelection();
    activeRow.value = -1;
    const bankId = deps.selectedBankId.value;
    if (bankId === null) {
      questions.value = [];
      total.value = 0;
      return;
    }
    questionsLoading.value = true;
    try {
      const res = await api.get<QuestionPageResponse>(`/banks/${bankId}/questions`, {
        ...(typeFilter.value ? { type: typeFilter.value } : {}),
        ...(difficultyFilter.value ? { difficulty: difficultyFilter.value } : {}),
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
        ...(mediaOnlyFilter.value ? { mediaOnlyAnalysis: 1 } : {}),
        page: page.value,
        pageSize: pageSize.value,
      });
      questions.value = res.questions;
      total.value = res.total;
      page.value = res.page;
    } catch (e) {
      toast.error(errorMessage(e));
      questions.value = [];
      total.value = 0;
    } finally {
      questionsLoading.value = false;
    }
  }

  /** 没有选中题库时清空列表（只清题目，不动 total：与原来的行为一致） */
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
    showMoreFilters.value = false;
    search();
  }

  /** 体检面板「解析纯图片」点一下 → 左侧题库列表按这个条件筛出来 */
  function showMediaOnlyQuestions(): void {
    mediaOnlyFilter.value = true;
    search();
    void nextTick(() => document.querySelector('.bank-panel__listhead')?.scrollIntoView({ behavior: 'smooth' }));
  }

  function goPage(delta: number): void {
    const next = page.value + delta;
    if (next < 1 || next > totalPages.value) return;
    page.value = next;
    void loadQuestions();
  }

  /** 切题库：重置筛选（关键词/题型/难度）并从第一页开始，与原来一致 */
  async function selectBank(bank: Bank): Promise<void> {
    if (deps.selectedBankId.value === bank.id) return;
    deps.selectedBankId.value = bank.id;
    typeFilter.value = '';
    difficultyFilter.value = '';
    keyword.value = '';
    page.value = 1;
    await loadQuestions();
  }

  function letter(index: number): string {
    return String.fromCharCode(65 + index);
  }

  /** 存储的答案既可能是下标串（"0,2"），也可能是旧的字母串（"AC" / "A,C"） */
  function answerIndexes(raw: string | undefined): number[] {
    const s = (raw ?? '').trim();
    if (!s) return [];
    if (/^[A-Fa-f](,?[A-Fa-f])*$/.test(s)) {
      const letters: number[] = [];
      for (const ch of s.toUpperCase()) {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 70) letters.push(code - 65);
      }
      return [...new Set(letters)].sort((a, b) => a - b);
    }
    return s
      .split(',')
      .map((x) => Number.parseInt(x.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);
  }

  function answerText(question: QuestionView): string {
    if (question.type === 'judge') return question.answer === 'T' ? '对' : '错';
    if (question.type === 'single' || question.type === 'multiple') {
      const letters = answerIndexes(question.answer).map(letter).join('');
      return letters || '—';
    }
    return question.answer ?? '—';
  }

  /* ---------------- 显示偏好（localStorage） ---------------- */
  const density = ref<'comfortable' | 'compact'>('comfortable');
  const showMeta = ref(true);
  function loadPrefs(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as {
        density?: 'comfortable' | 'compact';
        showMeta?: boolean;
      };
      if (raw.density === 'compact' || raw.density === 'comfortable') density.value = raw.density;
      if (typeof raw.showMeta === 'boolean') showMeta.value = raw.showMeta;
    } catch {
      /* 隐私模式读不到 localStorage：用默认值 */
    }
  }
  function savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ density: density.value, showMeta: showMeta.value }));
    } catch {
      /* 忽略 */
    }
  }
  watch([density, showMeta], savePrefs);

  /** 「显示」菜单项：一次点击切换一项 */
  const viewMenuItems = computed(() => [
    {
      key: 'density',
      label: density.value === 'compact' ? '行高：紧凑（点击切换为舒适）' : '行高：舒适（点击切换为紧凑）',
    },
    { key: 'meta', label: showMeta.value ? '隐藏题目难度/知识点' : '显示题目难度/知识点' },
  ]);
  function onViewMenu(key: string): void {
    if (key === 'density') density.value = density.value === 'compact' ? 'comfortable' : 'compact';
    else if (key === 'meta') showMeta.value = !showMeta.value;
  }

  /* ---------------- 题目编辑器 ---------------- */
  const qOpen = ref(false);
  const qSaving = ref(false);
  const qEditingId = ref<number | null>(null);
  const qImagePath = ref('');

  const qForm = reactive<QuestionFormDraft>({
    type: 'single',
    stem: '',
    options: [{ text: '' }, { text: '' }] as OptionDraft[],
    singleAnswer: 0,
    multipleAnswer: [] as number[],
    judgeAnswer: 'T',
    textAnswer: '',
    analysis: '',
    sort: 0,
    /** 难度：空串 = 交给难度模型自动判定；选了三档就记为人工标注 */
    difficulty: '',
  });

  const isChoice = computed(() => qForm.type === 'single' || qForm.type === 'multiple');

  function resetQuestionForm(): void {
    qEditingId.value = null;
    qImagePath.value = '';
    qForm.type = 'single';
    qForm.stem = '';
    qForm.options = [{ text: '' }, { text: '' }];
    qForm.singleAnswer = 0;
    qForm.multipleAnswer = [];
    qForm.judgeAnswer = 'T';
    qForm.textAnswer = '';
    qForm.analysis = '';
    qForm.sort = 0;
    qForm.difficulty = '';
  }

  function openCreateQuestion(): void {
    if (deps.selectedBankId.value === null) {
      toast.warning('请先选择或创建一个题库');
      return;
    }
    resetQuestionForm();
    qForm.sort = total.value;
    qOpen.value = true;
  }

  function openEditQuestion(question: QuestionView): void {
    resetQuestionForm();
    qEditingId.value = question.id;
    qImagePath.value = question.image_path;
    qForm.type = question.type;
    qForm.stem = question.stem;
    qForm.analysis = question.analysis ?? '';
    qForm.sort = question.sort;
    qForm.options =
      question.options.length > 0 ? question.options.map((text) => ({ text })) : [{ text: '' }, { text: '' }];
    const picked = answerIndexes(question.answer);
    if (question.type === 'single') qForm.singleAnswer = picked[0] ?? 0;
    if (question.type === 'multiple') qForm.multipleAnswer = picked;
    if (question.type === 'judge') qForm.judgeAnswer = question.answer === 'F' ? 'F' : 'T';
    if (question.type === 'fill' || question.type === 'short') qForm.textAnswer = question.answer ?? '';
    // 已经人工标注过的才回填三档；模型算出来的不预填，避免老师一保存就被当成人工标注
    qForm.difficulty =
      question.difficulty_source === 'manual' &&
      (question.difficulty === 'easy' || question.difficulty === 'medium' || question.difficulty === 'hard')
        ? question.difficulty
        : '';
    qOpen.value = true;
  }

  /** 保存时丢弃空选项，并把答案下标重映射到过滤后的位置 */
  function compactOptions(): { texts: string[]; map: number[] } {
    const texts: string[] = [];
    const map: number[] = [];
    qForm.options.forEach((option, index) => {
      const text = option.text.trim();
      if (!text) return;
      texts.push(text);
      map.push(index);
    });
    return { texts, map };
  }

  async function saveQuestion(): Promise<void> {
    const bankId = deps.selectedBankId.value;
    if (bankId === null) return;
    const stem = qForm.stem.trim();
    if (!stem) {
      toast.warning('请填写题干');
      return;
    }

    const { texts, map } = compactOptions();
    let answer = '';
    if (isChoice.value) {
      if (texts.length < 2) {
        toast.warning('选择题至少需要 2 个非空选项');
        return;
      }
      const picked = qForm.type === 'single' ? [qForm.singleAnswer] : [...qForm.multipleAnswer].sort((a, b) => a - b);
      const indexes: number[] = [];
      for (const index of picked) {
        const mapped = map.indexOf(index);
        if (mapped >= 0) indexes.push(mapped);
      }
      if (indexes.length === 0) {
        toast.warning('请勾选正确答案');
        return;
      }
      answer = [...new Set(indexes)].sort((a, b) => a - b).join(',');
    } else if (qForm.type === 'judge') {
      answer = qForm.judgeAnswer;
    } else {
      answer = qForm.textAnswer.trim();
      if (!answer) {
        toast.warning(qForm.type === 'fill' ? '请填写填空题答案' : '请填写参考答案');
        return;
      }
    }

    const payload = {
      bankId,
      lessonId: deps.selectedBank.value?.lesson_id ?? null,
      type: qForm.type,
      stem,
      options: isChoice.value ? texts : [],
      answer,
      analysis: qForm.analysis.trim(),
      sort: Number(qForm.sort) || 0,
      // 非空表示老师手动指定（后端记 difficulty_source = 'manual'，之后自动重算不会覆盖）
      difficulty: qForm.difficulty,
    };

    qSaving.value = true;
    try {
      if (qEditingId.value === null) {
        await api.post<OkIdResponse>(`/banks/${bankId}/questions`, payload);
        toast.success('题目已添加');
      } else {
        await api.put<OkResponse>(`/questions/${qEditingId.value}`, payload);
        toast.success('题目已保存');
      }
      qOpen.value = false;
      await loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      qSaving.value = false;
    }
  }

  async function removeQuestion(question: QuestionView): Promise<void> {
    const preview = question.stem.length > 20 ? `${question.stem.slice(0, 20)}…` : question.stem;
    if (!window.confirm(`确定删除题目「${preview}」吗？该题目会从题库和已组试卷中移除。`)) return;
    try {
      await api.del<OkResponse>(`/questions/${question.id}`);
      toast.success('题目已删除');
      if (questions.value.length === 1 && page.value > 1) page.value -= 1;
      await loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function pickQuestionImage(): void {
    if (qEditingId.value === null) {
      toast.info('请先保存题目，再上传配图');
      return;
    }
    deps.qImageInput.value?.click();
  }

  async function onQuestionImagePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const id = qEditingId.value;
    if (!file || id === null) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.upload<ImageResponse>(`/questions/${id}/image`, fd);
      qImagePath.value = res.imagePath;
      toast.success('配图已上传');
      await loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return {
    // 列表与筛选
    questions,
    questionsLoading,
    typeFilter,
    difficultyFilter,
    keyword,
    mediaOnlyFilter,
    showMoreFilters,
    page,
    total,
    pageSize,
    totalPages,
    DIFFICULTY_OPTIONS,
    difficultyTitle,
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
    // 多选
    selectedIds,
    selectedCount,
    allOnPageSelected,
    toggleSelect,
    toggleSelectAllOnPage,
    clearSelection,
    bulkDifficultyItems,
    bulkBusy,
    bulkSetDifficulty,
    bulkDelete,
    // 题干展开
    expandedStems,
    isStemExpanded,
    toggleStem,
    // 键盘流
    tableWrap,
    activeRow,
    keywordInput,
    onTableKeydown,
    answerText,
    // 显示偏好
    density,
    showMeta,
    viewMenuItems,
    onViewMenu,
    loadPrefs,
    // 题目编辑器
    qOpen,
    qSaving,
    qEditingId,
    qImagePath,
    qForm,
    openCreateQuestion,
    openEditQuestion,
    saveQuestion,
    removeQuestion,
    pickQuestionImage,
    onQuestionImagePicked,
  };
}
