/**
 * 题库目录与左栏导航（课程 → 章节 → 小节 → 题库）。
 *
 * 从 BankAdminView 抽出：课程树、册次、未归属与目录层级；
 * 题库列表本身（搜索/排序/分页/选中）在 use-bank-list 里。
 * 跨组合式函数的依赖（题目列表与清空题目）由参数传入，模块内不保存任何全局单例。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { useBankList, type BankKindFilter, type BankListDeps } from '@/composables/use-bank-list';
import { useBankSections } from '@/composables/use-bank-sections';
import { useBankCourseDetail } from '@/composables/use-bank-course-detail';
import { useBankRebind } from '@/composables/use-bank-rebind';
import type { BankNavView } from '@/views/admin/bankTypes';

interface CatalogCourse {
  id: number;
  name: string;
  bankCount: number;
  questionCount: number;
  chapterCount: number;
}

interface CatalogResponse {
  courses: CatalogCourse[];
  unbound: { bankCount: number; questionCount: number };
  /** 未归属课程按册次分组（复习类、还没建课程的册次） */
  unboundBooks: { book: string; bankCount: number; questionCount: number }[];
  binding: { bound: number; unbound: number; banks: number };
}

/** 题库类型中文名（左栏题库行用） */
export const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };

/** 题库列表要用的外部能力：保留旧名，BankAdminView 从这里导入 */
export type BankCatalogDeps = BankListDeps;

export function useBankCatalog(deps: BankCatalogDeps) {
  const toast = useToastStore();

  /* ---------------- 筛选与目录范围 ---------------- */
  const kindFilter = ref<BankKindFilter>('');
  const bankKeyword = ref('');
  /** 「未归属课程」里选中的册次（细分导航） */
  const unboundBook = ref('');
  const onlyUnbound = ref(false);
  /** 目录树里选中的课程 id；null = 课程列表层级 */
  const catalogCourseId = ref<number | null>(null);

  /**
   * 左栏导航：**搜索优先，否则逐级下钻**（课程 → 题库，或册次 → 章节 → 题库）。
   * 搜索框一输入就直接跳到搜索结果，不再依赖树。
   */
  const searchActive = computed(() => bankKeyword.value.trim() !== '');
  /** useBankSections 创建时 bankList 还不存在；用可替换的回调打破循环依赖 */
  let reloadBanks = async (): Promise<void> => {};
  const sections = useBankSections({
    kindFilter,
    searchActive,
    reloadBanks: () => reloadBanks(),
    reloadCourseCatalog: () => loadCatalog(),
  });

  /** 题库列表（搜索/排序/分页/选中）由独立组合式函数持有，这里只提供筛选范围 */
  const bankList = useBankList(
    {
      kindFilter,
      bankKeyword,
      unboundBook,
      onlyUnbound,
      catalogCourseId,
      navView: sections.navView,
      bookPick: sections.bookPick,
      sectionPick: sections.sectionPick,
    },
    deps,
  );
  reloadBanks = () => bankList.loadBanks(false);
  const { loadBanks } = bankList;

  /* ---------------- 题库目录树（课程 → 章节 → 小节 → 题库） ---------------- */
  const catalog = ref<CatalogResponse>({
    courses: [],
    unbound: { bankCount: 0, questionCount: 0 },
    unboundBooks: [],
    binding: { bound: 0, unbound: 0, banks: 0 },
  });
  const catalogLoading = ref(false);
  const courseDetail = useBankCourseDetail();
  const rebindApi = useBankRebind({
    loadCatalog,
    loadBanks,
    loadBookCatalog: sections.loadBookCatalog,
  });

  /** 课程名搜索（课程有 50+ 门，给个快速过滤） */
  const courseKeyword = ref('');
  const visibleCourses = computed(() => {
    const k = courseKeyword.value.trim().toLowerCase();
    if (!k) return catalog.value.courses;
    return catalog.value.courses.filter((c) => c.name.toLowerCase().includes(k));
  });

  /**
   * 当前层级：courses（课程列表）/ books（未归属册次 / 全部册次）/ sections（章节）/
   * banks（题库列表）。搜索时直接落到 banks；模板与标题计数都读它。
   */
  const courseBrowseLevel = computed<'courses' | 'books' | 'banks'>(() => {
    if (searchActive.value) return 'banks';
    if (onlyUnbound.value) return unboundBook.value === '' ? 'books' : 'banks';
    return catalogCourseId.value === null ? 'courses' : 'banks';
  });
  const browseLevel = computed<'courses' | 'books' | 'sections' | 'banks'>(() =>
    sections.navView.value === 'book' ? sections.bookBrowseLevel.value : courseBrowseLevel.value,
  );
  const activeCourseName = computed(() => {
    if (onlyUnbound.value) return unboundBook.value !== '' ? `未归属 / ${unboundBook.value}` : '未归属课程';
    const course = catalog.value.courses.find((c) => c.id === catalogCourseId.value);
    return course?.name ?? '全部课程';
  });

  /** 左栏头部计数：层级不同，数的东西也不同 */
  const navCountLabel = computed(() => {
    if (sections.navView.value === 'book') {
      if (browseLevel.value === 'books') return `${sections.bookCatalog.value.length} 个册次`;
      if (browseLevel.value === 'sections') return `${sections.selectedBookSections.value.length} 个章节`;
      return `${bankList.banks.value.length} 个题库`;
    }
    if (browseLevel.value === 'courses') return `${catalog.value.courses.length} 门课程`;
    if (browseLevel.value === 'books') return `${catalog.value.unboundBooks.length} 个册次`;
    return `${bankList.banks.value.length} 个题库`;
  });

  /** 题库列表层的返回条：按钮文案与路径都随当前视图/层级变化 */
  const crumbBackLabel = computed(() => {
    if (searchActive.value) return '← 清除搜索';
    if (sections.navView.value === 'book') {
      return sections.sectionPick.value !== null ? '← 全部章节' : '← 全部册次';
    }
    return onlyUnbound.value && unboundBook.value !== '' ? '← 未归属册次' : '← 全部课程';
  });
  const crumbPath = computed(() => {
    if (searchActive.value) return ` / 搜索：${bankKeyword.value}`;
    if (sections.navView.value === 'book') {
      if (sections.bookPick.value === null) return '';
      const book = sections.bookLabel(sections.bookPick.value);
      if (sections.sectionPick.value === null) return ` / ${book}`;
      return ` / ${book} / ${sections.sectionLabel(sections.sectionPick.value)}`;
    }
    return ` / ${activeCourseName.value}`;
  });

  /** 返回键：搜索 → 清除；册次视图 → 回章节；未归属册次 → 回册次列表；否则回课程 */
  async function backFromBanks(): Promise<void> {
    if (searchActive.value) {
      bankKeyword.value = '';
      await loadBanks(false);
      return;
    }
    if (sections.navView.value === 'book') {
      sections.backFromBanks();
      return;
    }
    if (onlyUnbound.value && unboundBook.value !== '') {
      unboundBook.value = '';
      await loadBanks(false);
      return;
    }
    await pickCourse(null);
  }

  /** 视图切换（供左栏分段控件调用；持久化在 useBankSections 内） */
  function switchNavView(view: BankNavView): Promise<void> {
    return sections.switchNavView(view);
  }

  async function loadCatalog(): Promise<void> {
    catalogLoading.value = true;
    try {
      catalog.value = await api.get<CatalogResponse>(`/banks/catalog?kind=${kindFilter.value}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catalogLoading.value = false;
    }
  }

  /**
   * 切换题库类型后：当前选中的课程/册次若在新类型下已经没有内容，
   * 退回上一层级（课程列表 / 册次列表），不把用户留在空白页。
   */
  function fallbackLevel(): void {
    if (catalogCourseId.value !== null && !catalog.value.courses.some((c) => c.id === catalogCourseId.value)) {
      catalogCourseId.value = null;
      courseDetail.catalogCourseDetail.value = null;
    }
    if (unboundBook.value !== '' && !catalog.value.unboundBooks.some((b) => b.book === unboundBook.value)) {
      unboundBook.value = '';
    }
  }

  /** 类型筛选变化：课程/册次目录与列表一起刷新，先对齐层级再加载列表 */
  watch(kindFilter, async () => {
    await Promise.all([loadCatalog(), sections.loadBookCatalog()]);
    fallbackLevel();
    sections.fallbackBookSelection();
    await loadBanks(false);
  });

  async function pickCourse(courseId: number | null): Promise<void> {
    sections.navView.value = 'course';
    catalogCourseId.value = courseId;
    onlyUnbound.value = false;
    unboundBook.value = '';
    // 拉一次课程详情：给「关联课时」下拉提供章节/课时选项
    if (courseId !== null) await courseDetail.loadCatalogCourse(courseId);
    await loadBanks(false);
  }

  async function pickUnbound(book = ''): Promise<void> {
    sections.navView.value = 'course';
    onlyUnbound.value = true;
    unboundBook.value = book;
    catalogCourseId.value = null;
    await loadBanks(false);
  }

  return {
    // 筛选与目录范围
    kindFilter,
    catalog,
    catalogLoading,
    catalogCourseId,
    onlyUnbound,
    unboundBook,
    bankKeyword,
    courseKeyword,
    visibleCourses,
    searchActive,
    browseLevel,
    activeCourseName,
    navCountLabel,
    crumbBackLabel,
    crumbPath,
    // 题库列表（use-bank-list，保持原有对外形状）
    ...bankList,
    // 按册次目录 / 章节回填
    ...sections,
    // 课程详情（关联课时下拉）与课程归属批量操作
    ...courseDetail,
    ...rebindApi,
    // 操作
    switchNavView,
    backFromBanks,
    loadBanks,
    loadCatalog,
    pickCourse,
    pickUnbound,
  };
}
