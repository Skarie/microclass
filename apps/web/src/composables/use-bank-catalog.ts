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
import type { Bank } from '@/api/types';

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

  /** 题库列表（搜索/排序/分页/选中）由独立组合式函数持有，这里只提供筛选范围 */
  const bankList = useBankList({ kindFilter, bankKeyword, unboundBook, onlyUnbound, catalogCourseId }, deps);
  const { loadBanks } = bankList;

  /* ---------------- 题库目录树（课程 → 章节 → 小节 → 题库） ---------------- */
  const catalog = ref<CatalogResponse>({
    courses: [],
    unbound: { bankCount: 0, questionCount: 0 },
    unboundBooks: [],
    binding: { bound: 0, unbound: 0, banks: 0 },
  });
  const catalogLoading = ref(false);
  const catalogCourseDetail = ref<CatalogDetail | null>(null);
  const catalogCourseLoading = ref<number | null>(null);
  const rebinding = ref(false);
  /** 自动匹配后仍未归属的册次（提示老师手工挂） */
  const unmatchedBooks = ref<{ book: string; banks: number }[]>([]);

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
      catalogCourseDetail.value = null;
    }
    if (unboundBook.value !== '' && !catalog.value.unboundBooks.some((b) => b.book === unboundBook.value)) {
      unboundBook.value = '';
    }
  }

  /** 类型筛选变化：目录与列表一起刷新，先对齐层级再加载列表 */
  watch(kindFilter, async () => {
    await loadCatalog();
    fallbackLevel();
    await loadBanks(false);
  });

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
    // 筛选与目录范围
    kindFilter,
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
    courseKeyword,
    visibleCourses,
    searchActive,
    browseLevel,
    activeCourseName,
    courseLessonOptions,
    // 题库列表（use-bank-list，保持原有对外形状）
    ...bankList,
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
