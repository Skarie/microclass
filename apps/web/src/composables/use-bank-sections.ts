/**
 * 题库「按册次」目录与章节回填。
 *
 * 与 use-bank-catalog 的课程树并列：册次视图只认 `banks.book / banks.section`，
 * 不依赖课程，所以没有课程的题库也能归类。列表过滤（book + section）由
 * use-bank-list 读取这里的状态，目录范围变化后由本文件回调它刷新。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { useBankBackfill } from '@/composables/use-bank-backfill';
import type { BankKindFilter } from '@/composables/use-bank-list';
import type { BankNavView, BankSectionBook, BankSectionCatalog, BookNavLevel } from '@/views/admin/bankTypes';

const NAV_VIEW_KEY = 'mc.banks.navView';

/** 读上次选择的目录视图；隐私模式禁用 localStorage 时退回「按课程」 */
function storedNavView(): BankNavView {
  try {
    return localStorage.getItem(NAV_VIEW_KEY) === 'book' ? 'book' : 'course';
  } catch {
    return 'course';
  }
}

export interface BankSectionsDeps {
  kindFilter: Ref<BankKindFilter>;
  /** 搜索时左栏直接落到题库列表，与按课程视图的搜索优先一致 */
  searchActive: ComputedRef<boolean>;
  /** 目录范围变化后刷新题库列表（由 use-bank-catalog 在列表创建后注入） */
  reloadBanks: () => Promise<void>;
  /** 回填会改变课程目录的计数 */
  reloadCourseCatalog: () => Promise<void>;
}

export function useBankSections(deps: BankSectionsDeps) {
  const toast = useToastStore();

  const navView = ref<BankNavView>(storedNavView());
  const bookCatalog = ref<BankSectionBook[]>([]);
  const bookCatalogLoading = ref(false);
  /** 选中的册次；null = 还在册次列表层，'' = 未归类册次 */
  const bookPick = ref<string | null>(null);
  /** 选中的章节；null = 还在章节列表层，'' = 未分章 */
  const sectionPick = ref<string | null>(null);

  watch(navView, (view) => {
    try {
      localStorage.setItem(NAV_VIEW_KEY, view);
    } catch {
      /* 浏览器禁用存储时只影响下次打开，不影响当前页面 */
    }
  });

  const bookLabel = (book: string): string => (book === '' ? '未归类册次' : book);
  const sectionLabel = (section: string): string => (section === '' ? '未分章' : section);

  const selectedBook = computed(() => bookCatalog.value.find((b) => b.book === bookPick.value) ?? null);
  const selectedBookSections = computed(() => selectedBook.value?.sections ?? []);
  const bookBrowseLevel = computed<BookNavLevel>(() => {
    if (deps.searchActive.value) return 'banks';
    if (bookPick.value === null) return 'books';
    return sectionPick.value === null ? 'sections' : 'banks';
  });

  /** 章节候选：跨册次去重，保持后端自然序，取前 30 个（空串不占候选） */
  const sectionOptions = computed(() => {
    const seen = new Set<string>();
    for (const book of bookCatalog.value) {
      for (const section of book.sections) if (section.section !== '') seen.add(section.section);
    }
    return [...seen].slice(0, 30);
  });
  /** 册次候选：同样只给前 30 个，避免下拉过长 */
  const bookOptions = computed(() =>
    bookCatalog.value
      .map((book) => book.book)
      .filter((book) => book !== '')
      .slice(0, 30),
  );

  async function loadBookCatalog(): Promise<void> {
    bookCatalogLoading.value = true;
    try {
      const kind = deps.kindFilter.value;
      const res = await api.get<BankSectionCatalog>('/banks/catalog-sections', {
        view: 'book',
        ...(kind === '' ? {} : { kind }),
      });
      bookCatalog.value = res.view === 'book' ? res.books : [];
    } catch (e) {
      toast.error(errorMessage(e));
      bookCatalog.value = [];
    } finally {
      bookCatalogLoading.value = false;
    }
  }

  /** 题库类型或数据变化后，选中的册次/章节可能已不存在，退回上层 */
  function fallbackBookSelection(): void {
    if (bookPick.value === null) return;
    const book = bookCatalog.value.find((b) => b.book === bookPick.value);
    if (!book) {
      bookPick.value = null;
      sectionPick.value = null;
      return;
    }
    if (sectionPick.value !== null && !book.sections.some((s) => s.section === sectionPick.value)) {
      sectionPick.value = null;
    }
  }

  async function switchNavView(view: BankNavView): Promise<void> {
    if (navView.value === view) return;
    navView.value = view;
    if (view === 'book') {
      bookPick.value = null;
      sectionPick.value = null;
      await loadBookCatalog();
    }
    await deps.reloadBanks();
  }

  function pickBook(book: string): void {
    bookPick.value = book;
    sectionPick.value = null;
  }

  async function pickSection(section: string): Promise<void> {
    sectionPick.value = section;
    await deps.reloadBanks();
  }

  function clearBookPick(): void {
    bookPick.value = null;
    sectionPick.value = null;
  }

  /** 题库列表的返回键：先回章节列表（册次层由册次导航自己处理） */
  function backFromBanks(): void {
    if (sectionPick.value !== null) sectionPick.value = null;
  }

  const backfill = useBankBackfill({
    kindFilter: deps.kindFilter,
    reloadBanks: deps.reloadBanks,
    reloadCourseCatalog: deps.reloadCourseCatalog,
    reloadBookCatalog: () => loadBookCatalog(),
  });

  return {
    navView,
    bookCatalog,
    bookCatalogLoading,
    bookPick,
    sectionPick,
    selectedBook,
    selectedBookSections,
    bookBrowseLevel,
    sectionOptions,
    bookOptions,
    bookLabel,
    sectionLabel,
    loadBookCatalog,
    fallbackBookSelection,
    switchNavView,
    pickBook,
    pickSection,
    clearBookPick,
    backFromBanks,
    // 批量回填章节（独立 composable，保持原有对外形状）
    ...backfill,
  };
}
