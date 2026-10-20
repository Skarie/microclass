/**
 * 题库目录与左栏导航（课程 → 章节 → 小节 → 题库）。
 *
 * 从 BankAdminView 抽出：课程树、册次、未归属、题库搜索/排序/分页，
 * 以及 loadBanks 的请求参数拼装。跨组合式函数的依赖（题目列表与清空题目）
 * 由参数传入，模块内不保存任何全局单例。
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';

interface BankListResponse {
  banks: Bank[];
  /** 当前筛选条件下的题库总数（服务端分页用） */
  total?: number;
}

interface OkResponse {
  ok: boolean;
}

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

interface CatalogLesson {
  id: number;
  title: string;
  bankCount: number;
  questionCount: number;
  banks: { id: number; name: string; kind: string; questionCount: number }[];
}

/** 单个课程的章节/课时细节：用于「关联课时」下拉（左栏导航已不使用它） */
interface CatalogDetail {
  course: { id: number; name: string } | undefined;
  chapters: {
    name: string;
    lessonCount: number;
    bankCount: number;
    questionCount: number;
    lessons: CatalogLesson[];
    banks: { id: number; name: string; kind: string; point: string; questionCount: number }[];
  }[];
}

/** 题库类型中文名（左栏题库行用） */
export const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };

/** 服务端分页：一次最多取 300 个题库（全库有 1.2 万个，之前一次全拉会拖垮页面） */
const BANKS_PAGE = 300;

/**
 * 题库列表先只渲染前 50 条（可展开）。
 * 左栏一次最多 300 条，每条都带一个下拉菜单组件，DOM 会到 4000+ 节点；
 * 绝大多数情况下老师会先搜索，先给 50 条既够用又轻。
 */
const BANK_LIST_PAGE = 50;

/** 题库列表要用的外部能力：题目列表的加载与清空（由父组件注入，运行时才调用） */
export interface BankCatalogDeps {
  loadQuestions: () => Promise<void>;
  clearQuestions: () => void;
}

export function useBankCatalog(deps: BankCatalogDeps) {
  const toast = useToastStore();

  /* ---------------- 题库列表（范围由目录树决定） ---------------- */
  /** 目录树里选中的小节（课时）id；null = 整个课程 */
  const kindFilter = ref<'' | 'lesson' | 'chapter' | 'paper'>('');
  const banks = ref<Bank[]>([]);
  /** 当前筛选条件下题库总数（服务端分页，页面只取前 N 个，避免一次拉 1 万多条） */
  const banksTotal = ref(0);
  const banksLoading = ref(false);
  const selectedBankId = ref<number | null>(null);

  const selectedBank = computed(() => banks.value.find((b) => b.id === selectedBankId.value) ?? null);

  /* ---------------- 题库目录树（课程 → 章节 → 小节 → 题库） ---------------- */
  const catalog = ref<CatalogResponse>({
    courses: [],
    unbound: { bankCount: 0, questionCount: 0 },
    unboundBooks: [],
    binding: { bound: 0, unbound: 0, banks: 0 },
  });
  const catalogLoading = ref(false);
  const catalogCourseId = ref<number | null>(null);
  const catalogCourseDetail = ref<CatalogDetail | null>(null);
  const catalogCourseLoading = ref<number | null>(null);
  const onlyUnbound = ref(false);
  const rebinding = ref(false);
  /** 「未归属课程」里选中的册次（细分导航） */
  const unboundBook = ref('');
  /** 自动匹配后仍未归属的册次（提示老师手工挂） */
  const unmatchedBooks = ref<{ book: string; banks: number }[]>([]);
  const bankKeyword = ref('');
  const showAllBanks = ref(false);
  /** 排序：默认沿用服务端顺序（最新创建在前），可切题量/名称 */
  const bankSort = ref<'default' | 'questions' | 'name'>('default');
  const sortedBanks = computed(() => {
    if (bankSort.value === 'default') return banks.value;
    const copy = [...banks.value];
    if (bankSort.value === 'questions') copy.sort((a, b) => b.question_count - a.question_count);
    else copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return copy;
  });
  const visibleBanks = computed(() =>
    showAllBanks.value ? sortedBanks.value : sortedBanks.value.slice(0, BANK_LIST_PAGE),
  );

  /**
   * 「关联课时」下拉的选项：只列**当前选中课程**的课时（含章节分组）。
   * 全库有 3,700+ 个课时，一次性拉 1.9MB 塞进下拉既慢又没法用；
   * 课程目录里已经有这些课时，直接用。
   */
  const courseLessonOptions = computed(() => {
    const chapters = catalogCourseDetail.value?.chapters ?? [];
    return chapters.flatMap((chapter) =>
      chapter.lessons.map((lesson) => ({ id: lesson.id, title: `${chapter.name} · ${lesson.title}` })),
    );
  });

  /** 课程名搜索（课程有 50+ 门，给个快速过滤） */
  const courseKeyword = ref('');
  const visibleCourses = computed(() => {
    const k = courseKeyword.value.trim().toLowerCase();
    if (!k) return catalog.value.courses;
    return catalog.value.courses.filter((c) => c.name.toLowerCase().includes(k));
  });

  /**
   * 左栏导航：**搜索优先，否则逐级下钻**（课程 → 题库）。
   * 搜索框一输入就直接跳到搜索结果，不再依赖树。
   */
  const searchActive = computed(() => bankKeyword.value.trim() !== '');
  /**
   * 当前层级：courses（课程列表）/ books（未归属的册次列表）/ banks（题库列表）。
   * 搜索时直接落到 banks；模板与标题计数都读它，避免三处各写一遍条件。
   */
  const browseLevel = computed<'courses' | 'books' | 'banks'>(() => {
    if (searchActive.value) return 'banks';
    if (onlyUnbound.value) return unboundBook.value === '' ? 'books' : 'banks';
    return catalogCourseId.value === null ? 'courses' : 'banks';
  });
  const activeCourseName = computed(() => {
    if (onlyUnbound.value) return unboundBook.value !== '' ? `未归属 / ${unboundBook.value}` : '未归属课程';
    const course = catalog.value.courses.find((c) => c.id === catalogCourseId.value);
    return course?.name ?? '全部课程';
  });

  /**
   * 题库名**输入即搜**（300ms 防抖）。
   * 左栏搜索原来只认回车，老师输完常常以为"没搜到"；与题目关键词搜索保持一致。
   */
  let bankKeywordTimer: ReturnType<typeof setTimeout> | undefined;
  watch(bankKeyword, () => {
    if (bankKeywordTimer) clearTimeout(bankKeywordTimer);
    bankKeywordTimer = setTimeout(() => void loadBanks(false), 300);
  });

  async function loadBanks(keepSelection = true): Promise<void> {
    banksLoading.value = true;
    try {
      const res = await api.get<BankListResponse>('/banks', {
        ...(kindFilter.value === '' ? {} : { kind: kindFilter.value }),
        ...(bankKeyword.value ? { keyword: bankKeyword.value } : {}),
        ...(unboundBook.value ? { book: unboundBook.value } : {}),
        ...(onlyUnbound.value
          ? { courseId: 'unbound' }
          : catalogCourseId.value === null
            ? {}
            : { courseId: catalogCourseId.value }),
        // 服务端分页：一次最多取 300 个题库（全库有 1.2 万个，之前一次全拉会拖垮页面）
        limit: BANKS_PAGE,
        offset: 0,
      });
      banks.value = res.banks;
      banksTotal.value = res.total ?? res.banks.length;
      const stillThere = banks.value.some((b) => b.id === selectedBankId.value);
      if (!keepSelection || !stillThere) {
        selectedBankId.value = banks.value[0]?.id ?? null;
      }
      if (selectedBankId.value === null) deps.clearQuestions();
      else await deps.loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
      banks.value = [];
      selectedBankId.value = null;
    } finally {
      banksLoading.value = false;
    }
  }

  async function loadCatalog(): Promise<void> {
    catalogLoading.value = true;
    try {
      catalog.value = await api.get<CatalogResponse>('/banks/catalog');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catalogLoading.value = false;
    }
  }

  async function pickCourse(courseId: number | null): Promise<void> {
    catalogCourseId.value = courseId;
    onlyUnbound.value = false;
    unboundBook.value = '';
    // 拉一次课程详情：给「关联课时」下拉提供章节/课时选项
    if (courseId !== null) await loadCatalogCourse(courseId);
    await loadBanks(false);
  }

  /** 取某课程的章节/课时细节（只服务「关联课时」下拉，左栏导航不再用它） */
  async function loadCatalogCourse(courseId: number): Promise<void> {
    catalogCourseLoading.value = courseId;
    try {
      catalogCourseDetail.value = await api.get<CatalogDetail>(`/banks/catalog?courseId=${courseId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      catalogCourseLoading.value = null;
    }
  }

  async function pickUnbound(book = ''): Promise<void> {
    onlyUnbound.value = true;
    unboundBook.value = book;
    catalogCourseId.value = null;
    await loadBanks(false);
  }

  /** 把某个题库挂到指定课程（「未归属」里手工归类） */
  async function bindBankCourse(bank: Bank, courseId: number | null): Promise<void> {
    try {
      await api.put<OkResponse>(`/banks/${bank.id}`, { name: bank.name, lessonId: bank.lesson_id, courseId });
      toast.success(courseId === null ? `已把「${bank.name}」移出课程` : `已把「${bank.name}」挂到课程`);
      await Promise.all([loadCatalog(), loadBanks()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function rebind(): Promise<void> {
    rebinding.value = true;
    try {
      const res = await api.post<{
        byLesson: number;
        byBook: number;
        unmatched: number;
        unmatchedBooks: { book: string; banks: number }[];
      }>('/banks/rebind-courses');
      toast.success(`已归属课程：课时推导 ${res.byLesson} 个、册次匹配 ${res.byBook} 个；仍未归属 ${res.unmatched} 个`);
      unmatchedBooks.value = res.unmatchedBooks;
      await loadCatalog();
      await loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      rebinding.value = false;
    }
  }

  return {
    // 状态
    kindFilter,
    banks,
    banksTotal,
    banksLoading,
    selectedBankId,
    selectedBank,
    catalog,
    catalogLoading,
    catalogCourseId,
    catalogCourseDetail,
    catalogCourseLoading,
    onlyUnbound,
    rebinding,
    unboundBook,
    unmatchedBooks,
    bankKeyword,
    showAllBanks,
    bankSort,
    sortedBanks,
    visibleBanks,
    courseLessonOptions,
    courseKeyword,
    visibleCourses,
    searchActive,
    browseLevel,
    activeCourseName,
    // 操作
    loadBanks,
    loadCatalog,
    loadCatalogCourse,
    pickCourse,
    pickUnbound,
    bindBankCourse,
    rebind,
  };
}
