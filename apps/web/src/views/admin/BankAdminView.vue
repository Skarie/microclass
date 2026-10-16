<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import PageHeader from '@/components/PageHeader.vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import DifficultyBadge from '@/components/DifficultyBadge.vue';
import { difficultyLabel, difficultySourceLabel } from '@/composables/difficulty';
import type { Bank, QuestionType, QuestionView } from '@/api/types';

interface BankListResponse {
  banks: Bank[];
  /** 当前筛选条件下的题库总数（服务端分页用） */
  total?: number;
}

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

interface ImportResponse {
  ok: boolean;
  inserted: number;
  errors: string[];
  /** 能导入但需要留意的提示（如被忽略的图片链接） */
  warnings?: string[];
}

/** 选项草稿：用对象包裹，避免下标访问在 strict 下的 undefined 噪音 */
interface OptionDraft {
  text: string;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
  short: '简答题',
};

const TYPE_OPTIONS: QuestionType[] = ['single', 'multiple', 'judge', 'fill', 'short'];
const DIFFICULTY_LABEL: Record<string, string> = { easy: '基础', medium: '中等', hard: '较难' };
const DEFAULT_PAGE_SIZE = 20;

const toast = useToastStore();

/* ---------------- 题库列表（范围由目录树决定） ---------------- */
/** 目录树里选中的小节（课时）id；null = 整个课程 */
const kindFilter = ref<'' | 'lesson' | 'chapter' | 'paper'>('');
const banks = ref<Bank[]>([]);
/** 当前筛选条件下题库总数（服务端分页，页面只取前 N 个，避免一次拉 1 万多条） */
const banksTotal = ref(0);
const BANKS_PAGE = 300;
const banksLoading = ref(false);
const selectedBankId = ref<number | null>(null);

const selectedBank = computed(() => banks.value.find((b) => b.id === selectedBankId.value) ?? null);

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
    if (selectedBankId.value === null) questions.value = [];
    else await loadQuestions();
  } catch (e) {
    toast.error(errorMessage(e));
    banks.value = [];
    selectedBankId.value = null;
  } finally {
    banksLoading.value = false;
  }
}

/* ---------------- 题库内去重（标准化） ---------------- */
interface DedupeResult {
  dryRun: boolean;
  groups: number;
  removable: number;
  removed: number;
  samples: { stem: string; count: number }[];
}
const dedupeBusy = ref(false);
const dedupeResult = ref<DedupeResult | null>(null);

async function previewDedupe(): Promise<void> {
  const bank = selectedBank.value;
  if (!bank) return;
  dedupeBusy.value = true;
  try {
    dedupeResult.value = await api.post<DedupeResult>(`/banks/${bank.id}/dedupe`, { dryRun: true });
    if (dedupeResult.value.removable === 0) {
      toast.info('这个题库里没有「题干+选项相同且答案一致」的重复题');
      dedupeResult.value = null;
    }
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    dedupeBusy.value = false;
  }
}

async function applyDedupe(): Promise<void> {
  const bank = selectedBank.value;
  if (!bank) return;
  dedupeBusy.value = true;
  try {
    const res = await api.post<DedupeResult>(`/banks/${bank.id}/dedupe`, { dryRun: false });
    toast.success(`已合并 ${res.removed} 道重复题（涉及 ${res.groups} 组）`);
    dedupeResult.value = null;
    await loadBanks();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    dedupeBusy.value = false;
  }
}

/* ---------------- 题库目录树（课程 → 章节 → 小节 → 题库） ---------------- */
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
/**
 * 题库列表先只渲染前 50 条（可展开）。
 * 左栏一次最多 300 条，每条都带一个下拉菜单组件，DOM 会到 4000+ 节点；
 * 绝大多数情况下老师会先搜索，先给 50 条既够用又轻。
 */
const BANK_LIST_PAGE = 50;
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

/** 课程名搜索（课程有 50+ 门，给个快速过滤） */
const courseKeyword = ref('');

/**
 * 题库名**输入即搜**（300ms 防抖）。
 * 左栏搜索原来只认回车，老师输完常常以为"没搜到"；与题目关键词搜索保持一致。
 */
let bankKeywordTimer: ReturnType<typeof setTimeout> | undefined;
watch(bankKeyword, () => {
  if (bankKeywordTimer) clearTimeout(bankKeywordTimer);
  bankKeywordTimer = setTimeout(() => void loadBanks(false), 300);
});

const visibleCourses = computed(() => {
  const k = courseKeyword.value.trim().toLowerCase();
  if (!k) return catalog.value.courses;
  return catalog.value.courses.filter((c) => c.name.toLowerCase().includes(k));
});

/**
 * 左栏导航：**搜索优先，否则逐级下钻**（课程 → 题库）。
 *
 * 为什么改：原来左栏是"巨型课程树（12,682 个题库）+ 平铺 300 条题库列表"两层叠在一起，
 * 既没有结构也不好用。现在一级只列课程（含"未归属课程"），点进去才看该课程的题库，
 * 面包屑可返回；搜索框一输入就直接跳到搜索结果，不再依赖树。
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
 * 题库详情区的次要操作菜单。
 * 之前这里是 8 个同权重按钮并排（主次不分），现在只留「导入题目 / 新建题目」，
 * 导出与整卷相关操作收进「导出 / 更多」。
 */
const bankMenuItems = computed(() => [
  {
    key: 'export-csv',
    label: '导出 CSV',
    icon: 'download' as const,
    hint: 'Excel 继续编辑',
    disabled: !selectedBank.value,
  },
  {
    key: 'export-md',
    label: '导出 Markdown',
    icon: 'download' as const,
    hint: '可贴进笔记软件',
    disabled: !selectedBank.value,
  },
  {
    key: 'export-docx',
    label: '导出 Word（含答案）',
    icon: 'print' as const,
    hint: '打印发给教研组',
    disabled: !selectedBank.value,
  },
  {
    key: 'export-docx-blank',
    label: 'Word 试卷（不含答案）',
    icon: 'print' as const,
    hint: '直接发给学生',
    disabled: !selectedBank.value,
  },
  {
    key: 'exam',
    label: '用这份试卷建考试',
    icon: 'exam' as const,
    hint: '按题目顺序生成考试',
    disabled: !selectedBank.value || selectedBank.value.kind !== 'paper',
  },
  {
    key: 'template-csv',
    label: '下载 CSV 模板',
    icon: 'download' as const,
    hint: '按模板填好后再导入',
  },
  {
    key: 'template-md',
    label: '下载 Markdown 模板',
    icon: 'download' as const,
  },
  {
    key: 'dedupe',
    label: '清理重复题',
    icon: 'copy' as const,
    hint: '题干+选项+答案一致才合并',
    disabled: !selectedBank.value || dedupeBusy.value,
  },
]);

/**
 * 题库列表里每一行的「⋯」菜单。
 *
 * 设计取舍（原页面的"反人类"点之一）：左栏每个题库行都常显 3 个按钮
 * （重命名 / 删除），300 行就是 900 个按钮 —— 又挤又容易误点删除。
 * 现在行内只保留名称与题量，操作收进选中/悬停才出现的菜单。
 */
function bankRowMenuItems() {
  return [
    { key: 'rename', label: '重命名', icon: 'edit' as const },
    { key: 'delete', label: '删除题库', icon: 'trash' as const, danger: true },
  ];
}

function onBankRowMenu(bank: Bank, key: string): void {
  if (key === 'rename') openEditBank(bank);
  else if (key === 'delete') void removeBank(bank);
}

function onBankMenuSelect(key: string): void {
  switch (key) {
    case 'template-csv':
      void downloadTemplate('csv');
      break;
    case 'template-md':
      void downloadTemplate('md');
      break;
    case 'export-csv':
      void exportBank('csv');
      break;
    case 'export-md':
      void exportBank('md');
      break;
    case 'export-docx':
      void exportBank('docx');
      break;
    case 'export-docx-blank':
      void exportBank('docx', false);
      break;
    case 'exam':
      openExamFromBank();
      break;
    case 'dedupe':
      void previewDedupe();
      break;
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

/* ---------------- 难度重算（内容特征先验 + 作答校准） ---------------- */
interface DifficultyPreview {
  scope: { bankId: number | null; name: string };
  total: number;
  willScore: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: { easyMax: number; mediumMax: number; five: number[] };
  predicted: {
    buckets: { difficulty: string; questions: number; ratio: number }[];
    levels: { level: number; label: string; questions: number; ratio: number }[];
  };
  current: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    sources: { source: string; questions: number }[];
  };
  samples: {
    easiest: { id: number; stem: string; score: number; reasons: string }[];
    hardest: { id: number; stem: string; score: number; reasons: string }[];
  };
}

interface DifficultyApplyResult {
  scored: number;
  updated: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: { easyMax: number; mediumMax: number };
  buckets: { difficulty: string; questions: number }[];
}

const diffOpen = ref(false);
const diffBusy = ref(false);
const diffPreview = ref<DifficultyPreview | null>(null);
/** 全库重算（不限于当前题库）：量大，默认勾选也只在老师点确认后执行 */
const diffScopeAll = ref(false);

const SOURCE_LABEL: Record<string, string> = {
  auto: '模型先验',
  calibrated: '作答校准',
  manual: '人工标注',
  unknown: '未评估',
};

async function openDifficulty(): Promise<void> {
  diffOpen.value = true;
  await loadDifficultyPreview();
}

async function loadDifficultyPreview(): Promise<void> {
  diffBusy.value = true;
  diffPreview.value = null;
  try {
    const query = diffScopeAll.value || !selectedBank.value ? '' : `?bankId=${selectedBank.value.id}`;
    diffPreview.value = await api.get<DifficultyPreview>(`/questions/difficulty/preview${query}`);
  } catch (e) {
    toast.error(errorMessage(e));
    diffOpen.value = false;
  } finally {
    diffBusy.value = false;
  }
}

async function applyDifficulty(): Promise<void> {
  diffBusy.value = true;
  try {
    const scope = diffScopeAll.value || !selectedBank.value ? '' : `?bankId=${selectedBank.value.id}`;
    const res = await api.post<DifficultyApplyResult>(`/questions/difficulty/apply${scope}`);
    toast.success(
      `已重算 ${res.updated} 道题的难度（保留人工 ${res.skippedManual} 道 / 已校准 ${res.skippedCalibrated} 道）`,
    );
    diffOpen.value = false;
    await loadBanks();
    await loadHealth();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    diffBusy.value = false;
  }
}

/** 用真实作答数据校准（有足够作答的题才动） */
async function calibrateDifficulty(): Promise<void> {
  diffBusy.value = true;
  try {
    const preview = await api.post<{ calibrated: number; candidates: number; minSamples: number; dryRun: boolean }>(
      '/questions/difficulty/calibrate',
    );
    if (preview.calibrated === 0) {
      toast.info(`还没有达到 ${preview.minSamples} 次作答的题目，暂时用不上作答数据校准`);
      return;
    }
    const applied = await api.post<{ calibrated: number }>('/questions/difficulty/calibrate?dryRun=0');
    toast.success(`已按作答数据校准 ${applied.calibrated} 道题的难度`);
    await loadBanks();
    await loadHealth();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    diffBusy.value = false;
  }
}

/* ---------------- 整卷试卷 → 一键建考试 ---------------- */
const examOpen = ref(false);
const examSaving = ref(false);
const courses = ref<{ id: number; name: string }[]>([]);
const examForm = reactive<{
  courseId: number | '';
  title: string;
  durationMinutes: number;
  passScore: number;
  publish: boolean;
}>({ courseId: '', title: '', durationMinutes: 60, passScore: 60, publish: true });

async function loadCourses(): Promise<void> {
  try {
    const res = await api.get<{ courses: { id: number; name: string }[] }>('/courses');
    courses.value = res.courses;
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function openExamFromBank(): void {
  if (!selectedBank.value) return;
  examForm.courseId = courses.value[0]?.id ?? '';
  examForm.title = selectedBank.value.name;
  examForm.durationMinutes = 60;
  examForm.passScore = 60;
  examForm.publish = true;
  examOpen.value = true;
}

async function createExamFromBank(): Promise<void> {
  const bank = selectedBank.value;
  if (!bank) return;
  if (examForm.courseId === '') {
    toast.warning('请选择要挂到哪门课程');
    return;
  }
  examSaving.value = true;
  try {
    const res = await api.post<{ examId: number; questions: number }>(`/banks/${bank.id}/exam`, {
      courseId: examForm.courseId,
      title: examForm.title,
      durationMinutes: examForm.durationMinutes,
      passScore: examForm.passScore,
      publish: examForm.publish,
    });
    toast.success(`已生成考试（${res.questions} 题），可到「考试管理」查看`);
    examOpen.value = false;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    examSaving.value = false;
  }
}

/* ---------------- 题库体检（标准化与质量） ---------------- */
interface BankHealth {
  scope: { bankId: number | null; name: string };
  stats: {
    total: number;
    missingDifficulty: number;
    emptyAnswer: number;
    withoutImage: number;
    withImage: number;
    /** 解析只有图片、没有一个字的题（图片里是解析文字截图） */
    mediaOnlyAnalysis: number;
    duplicateGroups: number;
    duplicateQuestions: number;
    conflictGroups: number;
    noFingerprint: number;
  };
  metadata: { withSubject: number; withBook: number; withPoint: number; withHash: number };
  duplicates: { content_hash: string; n: number; answers: number; stem: string }[];
  kinds: { kind: string; banks: number; questions: number }[];
  /** 难度结构（迁移 0016 的难度模型） */
  difficulty: {
    unscored: number;
    buckets: { difficulty: string; questions: number }[];
    levels: { level: number; questions: number }[];
    sources: { source: string; questions: number }[];
    histogram: { bucket: number; questions: number }[];
  };
}
const healthOpen = ref(false);
const healthLoading = ref(false);
const health = ref<BankHealth | null>(null);
const KIND_LABEL: Record<string, string> = { lesson: '课时配套', chapter: '章节题库', paper: '整卷试卷' };

async function loadHealth(silent = false): Promise<void> {
  healthLoading.value = true;
  try {
    health.value = await api.get<BankHealth>('/banks/health', { limit: 10 });
  } catch (e) {
    if (!silent) toast.error(errorMessage(e));
  } finally {
    healthLoading.value = false;
  }
}

function toggleHealth(): void {
  healthOpen.value = !healthOpen.value;
  if (healthOpen.value) void loadHealth();
}

/** 体检里的比例（百分比，保留一位小数） */
function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

async function selectBank(bank: Bank): Promise<void> {
  if (selectedBankId.value === bank.id) return;
  selectedBankId.value = bank.id;
  typeFilter.value = '';
  difficultyFilter.value = '';
  keyword.value = '';
  page.value = 1;
  await loadQuestions();
}

/* ---------------- 题库表单 ---------------- */
const bankFormOpen = ref(false);
const bankSaving = ref(false);
const bankEditingId = ref<number | null>(null);
const bankForm = reactive<{ name: string; lessonId: number | '' }>({ name: '', lessonId: '' });

function openCreateBank(): void {
  bankEditingId.value = null;
  bankForm.name = '';
  bankForm.lessonId = '';
  bankFormOpen.value = true;
}

function openEditBank(bank: Bank): void {
  bankEditingId.value = bank.id;
  bankForm.name = bank.name;
  bankForm.lessonId = bank.lesson_id === null ? '' : bank.lesson_id;
  bankFormOpen.value = true;
}

async function saveBank(): Promise<void> {
  const name = bankForm.name.trim();
  if (!name) {
    toast.warning('请填写题库名称');
    return;
  }
  const payload = { name, lessonId: bankForm.lessonId === '' ? null : Number(bankForm.lessonId) };
  bankSaving.value = true;
  try {
    if (bankEditingId.value === null) {
      const res = await api.post<OkIdResponse>('/banks', payload);
      toast.success(`题库「${name}」已创建`);
      bankFormOpen.value = false;
      selectedBankId.value = res.id;
      await loadBanks();
    } else {
      await api.put<OkResponse>(`/banks/${bankEditingId.value}`, payload);
      toast.success(`题库「${name}」已保存`);
      bankFormOpen.value = false;
      await loadBanks();
    }
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    bankSaving.value = false;
  }
}

async function removeBank(bank: Bank): Promise<void> {
  if (
    !window.confirm(`确定删除题库「${bank.name}」吗？其中的 ${bank.question_count} 道题目会被一并删除，且不可恢复。`)
  ) {
    return;
  }
  try {
    await api.del<OkResponse>(`/banks/${bank.id}`);
    toast.success(`题库「${bank.name}」已删除`);
    if (selectedBankId.value === bank.id) selectedBankId.value = null;
    await loadBanks(false);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

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
  const bankId = selectedBankId.value;
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
  const bankId = selectedBankId.value;
  const ids = [...selectedIds.value];
  if (bankId === null || ids.length === 0) return;
  if (!window.confirm(`确定删除选中的 ${ids.length} 道题吗？删除后不可恢复。`)) return;
  bulkBusy.value = true;
  try {
    const res = await api.post<{ deleted: number; skipped: number }>(`/banks/${bankId}/questions/bulk-delete`, { ids });
    toast.success(`已删除 ${res.deleted} 道题`);
    clearSelection();
    await loadQuestions();
    await loadBanks();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    bulkBusy.value = false;
  }
}

/** 按册次批量挂课程：选中的册次与目标课程 */
const bindBookTarget = ref<{ book: string; bankCount: number } | null>(null);
const bindCourseId = ref<number | ''>('');
const bindingBook = ref(false);

function openBindBook(item: { book: string; bankCount: number }): void {
  bindBookTarget.value = item;
  bindCourseId.value = '';
}

function closeBindBook(): void {
  bindBookTarget.value = null;
  bindCourseId.value = '';
}

async function confirmBindBook(): Promise<void> {
  const target = bindBookTarget.value;
  if (!target || bindCourseId.value === '') return;
  bindingBook.value = true;
  try {
    const res = await api.post<{ updated: number; courseName: string }>('/banks/bind-by-book', {
      book: target.book,
      courseId: Number(bindCourseId.value),
    });
    toast.success(`已把 ${res.updated} 个题库挂到「${res.courseName}」`);
    closeBindBook();
    await loadCatalog();
    await loadBanks(false);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    bindingBook.value = false;
  }
}

/**
 * 题库管理显示偏好（localStorage 记住）：
 *   行密度 与 是否显示题目元信息 —— 老师审题喜欢紧凑、录题喜欢信息全，两种人都要照顾。
 */
const PREFS_KEY = 'mc.bank.prefs';
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

/** 表格容器引用：点表格任意处让它获得焦点，↑↓ 就能直接用 */
const tableWrap = ref<HTMLElement | null>(null);

/** 文档级快捷键：/ 聚焦题干搜索（在输入框里打字时不拦截） */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== '/') return;
  const target = event.target as HTMLElement | null;
  const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if (typing) return;
  event.preventDefault();
  keywordInput.value?.focus();
}

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
  const bankId = selectedBankId.value;
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

/* ---------------- 题目编辑器 ---------------- */
const qOpen = ref(false);
const qSaving = ref(false);
const qEditingId = ref<number | null>(null);
const qImagePath = ref('');
const qImageInput = ref<HTMLInputElement | null>(null);
const qForm = reactive({
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
  if (selectedBankId.value === null) {
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

function addOption(): void {
  if (qForm.options.length >= 26) {
    toast.warning('最多支持 26 个选项');
    return;
  }
  qForm.options.push({ text: '' });
}

function removeOption(index: number): void {
  if (qForm.options.length <= 2) {
    toast.warning('选择题至少需要 2 个选项');
    return;
  }
  qForm.options.splice(index, 1);
  if (qForm.singleAnswer >= qForm.options.length) qForm.singleAnswer = 0;
  qForm.multipleAnswer = qForm.multipleAnswer.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
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
  const bankId = selectedBankId.value;
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
    lessonId: selectedBank.value?.lesson_id ?? null,
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
    await loadBanks();
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
    await loadBanks();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function pickQuestionImage(): void {
  if (qEditingId.value === null) {
    toast.info('请先保存题目，再上传配图');
    return;
  }
  qImageInput.value?.click();
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

/* ---------------- 导入导出：CSV / Markdown / Word ---------------- */
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const importResult = ref<{ inserted: number; errors: string[]; warnings: string[] } | null>(null);

async function downloadTemplate(kind: 'csv' | 'md'): Promise<void> {
  try {
    await api.download(kind === 'csv' ? '/banks/template.csv' : '/banks/template.md');
    toast.success(`${kind === 'csv' ? 'CSV' : 'Markdown'} 模板已开始下载`);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** 导出：CSV（Excel 继续编辑）/ Markdown（笔记软件、版本库）/ Word（打印、发给学生） */
async function exportBank(format: 'csv' | 'md' | 'docx', withAnswers = true): Promise<void> {
  const bank = selectedBank.value;
  if (!bank) {
    toast.warning('请先选择题库');
    return;
  }
  try {
    const path =
      format === 'csv'
        ? `/banks/${bank.id}/export.csv`
        : format === 'md'
          ? `/banks/${bank.id}/export.md`
          : `/banks/${bank.id}/export.docx`;
    await api.download(path, format === 'csv' ? undefined : { answers: withAnswers ? '1' : '0' });
    toast.success(`题库「${bank.name}」已开始下载`, format === 'docx' ? 'Word 可直接打印，配图已内嵌' : '');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function pickImportFile(): void {
  if (selectedBankId.value === null) {
    toast.warning('请先选择题库');
    return;
  }
  fileInput.value?.click();
}

async function onImportFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const bankId = selectedBankId.value;
  if (!file || bankId === null) return;
  const fd = new FormData();
  fd.append('file', file);
  importing.value = true;
  try {
    const res = await api.upload<ImportResponse>(`/banks/${bankId}/import`, fd);
    importResult.value = { inserted: res.inserted, errors: res.errors, warnings: res.warnings ?? [] };
    toast.success(`成功导入 ${res.inserted} 道题目`, res.errors.length > 0 ? `有 ${res.errors.length} 题未导入` : '');
    page.value = 1;
    await loadQuestions();
    await loadBanks();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    importing.value = false;
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown);
});

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown);
  loadPrefs();
  void loadCourses();
  void loadCatalog();
  void loadBanks(false);
  // 指标卡片要用体检数据（服务端已预热 + 5 分钟缓存，约 20ms；失败不影响页面）
  void loadHealth(true);
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="题库管理"
      description="按课程/章节维护题库，导入 CSV 或 Markdown 题目，导出 Word/CSV，处理重复题与难度标注。"
      icon="bank"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '题库管理' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="healthLoading" @click="toggleHealth">
          <Icon name="shield" :size="15" />
          {{ healthOpen ? '收起体检' : '题库体检' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="banksLoading" @click="loadBanks()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreateBank">
          <Icon name="plus" :size="15" />
          新建题库
        </button>
      </template>
    </PageHeader>

    <!-- 指标卡片行：先给全局规模感，再进入具体操作（对标学之思/超星的工作台形态） -->
    <div class="kpi">
      <div class="kpi__card">
        <div class="kpi__label">题库总数</div>
        <div class="kpi__value">{{ catalog.binding.banks.toLocaleString() }}</div>
        <div class="kpi__sub mc-muted">
          已归属 {{ catalog.binding.bound.toLocaleString() }} · 未归属
          {{ catalog.binding.unbound.toLocaleString() }}
        </div>
      </div>
      <div class="kpi__card">
        <div class="kpi__label">题目总量</div>
        <div class="kpi__value">{{ health ? health.stats.total.toLocaleString() : '—' }}</div>
        <div class="kpi__sub mc-muted">全部题库合计</div>
      </div>
      <button class="kpi__card kpi__card--action" type="button" @click="pickUnbound('')">
        <div class="kpi__label">未归属课程</div>
        <div class="kpi__value">{{ catalog.binding.unbound.toLocaleString() }}</div>
        <div class="kpi__sub mc-muted">点这里按册次归类 →</div>
      </button>
      <div class="kpi__card">
        <div class="kpi__label">待补答案</div>
        <div class="kpi__value">{{ health ? health.stats.emptyAnswer.toLocaleString() : '—' }}</div>
        <div class="kpi__sub mc-muted">答案册未覆盖，需补齐</div>
      </div>
    </div>

    <!-- 按册次批量挂课程：一次把该册次下所有未归属题库挂到目标课程 -->
    <AppModal :open="bindBookTarget !== null" title="按册次挂到课程" width="520px" @close="closeBindBook">
      <div class="mc-col bindbook">
        <p class="bindbook__lead">
          把「{{ bindBookTarget?.book }}」下的
          <strong>{{ bindBookTarget?.bankCount ?? 0 }}</strong>
          个未归属题库挂到：
        </p>
        <select v-model="bindCourseId" class="mc-select" aria-label="选择课程">
          <option value="">请选择课程…</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <p class="mc-muted bindbook__hint">
          只会影响该册次下<strong>尚未归属</strong>的题库；已经挂在其它课程下的题库不会被改动。
        </p>
      </div>
      <template #footer>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" @click="closeBindBook">取消</button>
        <button
          class="mc-btn mc-btn--sm mc-btn--primary"
          type="button"
          :disabled="bindingBook || bindCourseId === ''"
          @click="confirmBindBook"
        >
          {{ bindingBook ? '挂载中…' : '确认挂载' }}
        </button>
      </template>
    </AppModal>
    <!-- 题库体检：弹窗展示，避免在页面中间插入整块导致布局跳动 -->
    <AppModal
      :open="healthOpen"
      :title="`题库体检（${health?.scope.name ?? '全库'}）`"
      width="920px"
      @close="healthOpen = false"
    >
      <div v-if="healthLoading && !health" class="loading"><div class="mc-skeleton loading__row" /></div>
      <div v-else-if="health" class="mc-col health__body">
        <div class="mc-grid mc-grid--stats">
          <div class="metric">
            <div class="metric__value">{{ health.stats.total }}</div>
            <div class="mc-muted">题目总量</div>
          </div>
          <div class="metric">
            <div class="metric__value">{{ health.stats.duplicateGroups }}</div>
            <div class="mc-muted">重复题分组（{{ health.stats.duplicateQuestions }} 题）</div>
          </div>
          <div class="metric">
            <div class="metric__value">{{ health.stats.conflictGroups }}</div>
            <div class="mc-muted">
              同题不同答案
              <RouterLink v-if="health.stats.conflictGroups > 0" class="metric__link" to="/admin/question-conflicts">
                去核对 →
              </RouterLink>
            </div>
          </div>
          <div class="metric">
            <div class="metric__value">{{ health.stats.withImage }}</div>
            <div class="mc-muted">带配图（{{ pct(health.stats.withImage, health.stats.total) }}）</div>
          </div>
          <div class="metric" :class="{ 'metric--warn': health.stats.mediaOnlyAnalysis > 0 }">
            <div class="metric__value">{{ health.stats.mediaOnlyAnalysis }}</div>
            <div class="mc-muted">
              解析只有图片
              <button
                v-if="health.stats.mediaOnlyAnalysis > 0"
                class="metric__link metric__link--btn"
                type="button"
                @click="showMediaOnlyQuestions"
              >
                筛出来看 →
              </button>
            </div>
          </div>
          <div class="metric">
            <div class="metric__value">{{ health.stats.missingDifficulty }}</div>
            <div class="mc-muted">未标难度（旧的粗标）</div>
          </div>
        </div>

        <!-- 难度结构：三档 / 五级 / 来源（迁移 0016 的难度模型） -->
        <div v-if="health.difficulty" class="health__rows difficulty-panel">
          <div class="difficulty-panel__head">
            <span class="mc-card__title">难度划分</span>
            <span class="mc-muted"> 模型先验（内容特征）+ 作答数据校准 + 人工优先，阈值按分位数自动定 </span>
            <button class="mc-btn mc-btn--sm" type="button" @click="openDifficulty">重算难度</button>
            <button class="mc-btn mc-btn--sm" type="button" :disabled="diffBusy" @click="calibrateDifficulty">
              按作答校准
            </button>
          </div>
          <p class="mc-muted">
            三档：
            <span v-for="b in health.difficulty.buckets" :key="b.difficulty" class="health__kind">
              {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }} {{ b.questions }} （{{
                pct(b.questions, health.stats.total)
              }}）
            </span>
          </p>
          <p class="mc-muted">
            五级：
            <span v-for="l in health.difficulty.levels" :key="l.level" class="health__kind">
              {{ l.level === 0 ? '未评估' : `${l.level}★` }} {{ l.questions }}
            </span>
          </p>
          <p class="mc-muted">
            来源：
            <span v-for="s in health.difficulty.sources" :key="s.source" class="health__kind">
              {{ SOURCE_LABEL[s.source] ?? s.source }} {{ s.questions }}
            </span>
            <span v-if="health.difficulty.unscored > 0" class="health__kind">
              · 未算过 {{ health.difficulty.unscored }} 题
            </span>
          </p>
        </div>

        <div class="health__rows">
          <p class="mc-muted">
            标准化元数据覆盖率：学科 {{ pct(health.metadata.withSubject, health.stats.total) }}｜ 书册
            {{ pct(health.metadata.withBook, health.stats.total) }}｜ 知识点
            {{ pct(health.metadata.withPoint, health.stats.total) }}｜ 内容指纹
            {{ pct(health.metadata.withHash, health.stats.total) }}
          </p>
          <p class="mc-muted">
            题库类型：
            <span v-for="k in health.kinds" :key="k.kind" class="health__kind">
              {{ KIND_LABEL[k.kind] ?? k.kind }} {{ k.banks }} 个 / {{ k.questions }} 题
            </span>
          </p>
        </div>

        <div v-if="health.duplicates.length > 0" class="mc-table-wrap table-wrap">
          <table class="mc-table mc-table--compact">
            <thead>
              <tr>
                <th>重复题（题干）</th>
                <th>出现次数</th>
                <th>答案种类</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in health.duplicates" :key="d.content_hash">
                <td><RichText class="stem__text" :text="d.stem" /></td>
                <td>{{ d.n }}</td>
                <td>
                  <span class="mc-badge" :class="d.answers > 1 ? 'mc-badge--danger' : ''">{{ d.answers }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <template #footer>
        <span v-if="health" class="mc-muted">共 {{ health.stats.total }} 题</span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="healthLoading" @click="loadHealth()">
          重新统计
        </button>
        <button class="mc-btn mc-btn--sm mc-btn--primary" type="button" @click="healthOpen = false">关闭</button>
      </template>
    </AppModal>

    <div class="layout">
      <aside class="mc-card bank-panel">
        <div class="mc-card__header">
          <span class="mc-card__title">题库导航</span>
          <span class="mc-muted">
            {{ browseLevel === 'courses' ? catalog.courses.length + ' 门课程' : banks.length + ' 个题库' }}
          </span>
        </div>

        <!-- 搜索与类型筛选：属于「题库列表」，从课程树里提出来放到显眼位置 -->
        <div class="tree__toolbar">
          <input
            v-model.trim="bankKeyword"
            class="mc-input tree__search"
            type="search"
            placeholder="搜题库名（回车或输入即筛）"
            aria-label="搜索题库名"
            @keyup.enter="loadBanks(false)"
          />
          <select
            v-model="kindFilter"
            class="mc-select tree__kind"
            aria-label="按题库类型筛选"
            @change="loadBanks(false)"
          >
            <option value="">全部类型</option>
            <option value="lesson">课时配套</option>
            <option value="chapter">章节题库</option>
            <option value="paper">整卷试卷</option>
          </select>
        </div>

        <!-- 一级：课程列表（"未归属课程"置顶）；搜索时自动跳到搜索结果 -->
        <ul v-if="browseLevel === 'courses'" class="nav-list">
          <li class="nav-item" @click="pickUnbound('')">
            <span class="mc-truncate">未归属课程</span>
            <span class="mc-muted nav-item__meta">
              {{ catalog.unbound.bankCount }} 库 / {{ catalog.unbound.questionCount }} 题
            </span>
          </li>
          <li v-for="course in visibleCourses" :key="course.id" class="nav-item" @click="pickCourse(course.id)">
            <span class="mc-truncate">{{ course.name }}</span>
            <span class="mc-muted nav-item__meta">{{ course.bankCount }} 库 / {{ course.questionCount }} 题</span>
          </li>
        </ul>

        <!-- 二级：未归属课程 → 按册次分组 -->
        <template v-else-if="browseLevel === 'books'">
          <div class="nav-crumb">
            <button class="nav-crumb__back" type="button" @click="pickCourse(null)">← 全部课程</button>
            <span class="mc-muted mc-truncate">/ 未归属课程</span>
          </div>
          <ul class="nav-list">
            <li v-for="item in catalog.unboundBooks" :key="item.book" class="nav-item" @click="pickUnbound(item.book)">
              <span class="mc-truncate">{{ item.book }}</span>
              <span class="mc-muted nav-item__meta">{{ item.bankCount }} 库 / {{ item.questionCount }} 题</span>
              <!-- 1700+ 个未归属题库一个个挂太费事：按册次一次挂完 -->
              <button
                v-if="courses.length > 0"
                class="mc-btn mc-btn--ghost mc-btn--sm nav-item__bind"
                type="button"
                @click.stop="openBindBook(item)"
              >
                挂到课程
              </button>
            </li>
          </ul>
          <button
            class="mc-btn mc-btn--ghost mc-btn--sm tree__rebind"
            type="button"
            :disabled="rebinding"
            @click="rebind"
          >
            {{ rebinding ? '匹配中…' : '自动匹配课程归属' }}
          </button>
        </template>

        <!-- 三级：题库列表（搜索结果 / 某课程 / 某册次），带面包屑可返回 -->
        <div v-else class="bank-panel__list">
          <div class="nav-crumb">
            <button class="nav-crumb__back" type="button" @click="pickCourse(null)">← 全部课程</button>
            <span class="mc-muted mc-truncate">/ {{ searchActive ? bankKeyword : activeCourseName }}</span>
          </div>
          <div class="bank-panel__listhead mc-row">
            <span class="mc-muted">题库</span>
            <div class="mc-spacer" />
            <select v-model="bankSort" class="mc-select bank-panel__sort" aria-label="题库排序">
              <option value="default">最新创建</option>
              <option value="questions">题量最多</option>
              <option value="name">按名称</option>
            </select>
          </div>

          <div v-if="banksLoading && banks.length === 0" class="bank-panel__loading">
            <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
          </div>

          <EmptyState
            v-else-if="banks.length === 0"
            icon="bank"
            title="这个范围里还没有题库"
            description="换个课程/章节看看，或直接新建题库。"
            action-text="新建题库"
            @action="openCreateBank"
          />

          <ul v-else class="bank-list">
            <li
              v-for="bank in visibleBanks"
              :key="bank.id"
              class="bank-item"
              :class="{ 'bank-item--active': bank.id === selectedBankId }"
              @click="selectBank(bank)"
            >
              <div class="bank-item__main">
                <span class="bank-item__name" :title="bank.name">{{ bank.name }}</span>
                <span class="mc-muted bank-item__meta">
                  {{ KIND_LABEL[bank.kind ?? ''] ?? '' }} · {{ bank.question_count }} 题
                </span>
              </div>
              <!-- 行内只留一个「⋯」：原来常显 3 个按钮（重命名/删除等），又挤又容易误点删除 -->
              <div class="bank-item__actions">
                <select
                  v-if="onlyUnbound"
                  class="mc-select bank-item__bind"
                  aria-label="挂到课程"
                  @click.stop
                  @change="bindBankCourse(bank, Number(($event.target as HTMLSelectElement).value) || null)"
                >
                  <option value="">挂到课程…</option>
                  <option v-for="course in catalog.courses" :key="course.id" :value="course.id">
                    {{ course.name }}
                  </option>
                </select>
                <DropdownMenu
                  :items="bankRowMenuItems()"
                  label=""
                  icon="more"
                  :show-caret="false"
                  aria-label="题库操作（重命名 / 删除）"
                  variant="ghost"
                  @select="(key) => onBankRowMenu(bank, key)"
                />
              </div>
            </li>
          </ul>

          <button
            v-if="!showAllBanks && banks.length > visibleBanks.length"
            class="mc-btn mc-btn--ghost mc-btn--sm bank-panel__more"
            type="button"
            @click="showAllBanks = true"
          >
            显示全部 {{ sortedBanks.length }} 个（当前只显示前 {{ visibleBanks.length }} 个）
          </button>
        </div>
      </aside>

      <section class="mc-card question-panel">
        <!-- 题库头部：标题单行截断 + 右侧操作区固定（标题很长时不会把按钮挤到下一行） -->
        <div class="mc-card__header bank-head">
          <div class="bank-head__title">
            <span class="bank-head__name mc-truncate">{{ selectedBank ? selectedBank.name : '请选择题库' }}</span>
            <span v-if="selectedBank" class="bank-head__count mc-muted">共 {{ total }} 题</span>
          </div>
          <div class="bank-head__actions">
            <DropdownMenu
              :items="bankMenuItems"
              label="导出 / 更多"
              :icon="null"
              variant="ghost"
              @select="onBankMenuSelect"
            />
            <button
              class="mc-btn mc-btn--soft mc-btn--sm"
              type="button"
              :disabled="importing || !selectedBank"
              @click="pickImportFile"
            >
              <Icon name="upload" :size="15" />
              {{ importing ? '导入中…' : '导入题目' }}
            </button>
            <button
              class="mc-btn mc-btn--primary mc-btn--sm"
              type="button"
              :disabled="!selectedBank"
              @click="openCreateQuestion"
            >
              <Icon name="plus" :size="15" />
              新建题目
            </button>
          </div>
        </div>

        <div class="mc-card__body mc-col">
          <div class="mc-row mc-row--wrap filters">
            <div class="chips" role="group" aria-label="按题型筛选">
              <button
                class="chip"
                :class="{ 'chip--active': typeFilter === '' }"
                type="button"
                @click="setTypeFilter('')"
              >
                全部题型
              </button>
              <button
                v-for="t in TYPE_OPTIONS"
                :key="t"
                class="chip"
                :class="{ 'chip--active': typeFilter === t }"
                type="button"
                @click="setTypeFilter(t)"
              >
                {{ TYPE_LABEL[t] }}
              </button>
            </div>
            <div class="chips" role="group" aria-label="按难度筛选">
              <button
                class="chip"
                :class="{ 'chip--active': difficultyFilter === '' }"
                type="button"
                @click="setDifficultyFilter('')"
              >
                全部难度
              </button>
              <button
                v-for="d in DIFFICULTY_OPTIONS"
                :key="d.value"
                class="chip"
                :class="{ 'chip--active': difficultyFilter === d.value }"
                type="button"
                @click="setDifficultyFilter(d.value)"
              >
                {{ d.label }}
              </button>
            </div>
            <!-- 输入即搜（400ms 防抖），不再需要点"搜索" -->
            <input
              ref="keywordInput"
              v-model.trim="keyword"
              class="mc-input filters__keyword"
              type="search"
              placeholder="搜索题干关键词（输入即搜）"
              aria-label="搜索题干"
              @keyup.enter="search"
            />
            <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="resetFilters">重置</button>
            <DropdownMenu :items="viewMenuItems" label="显示" :icon="null" variant="ghost" @select="onViewMenu" />
            <label class="filters__more">
              <input v-model="showMoreFilters" type="checkbox" aria-label="展开更多筛选" />
              更多筛选
            </label>
            <label
              v-if="showMoreFilters"
              class="filters__check"
              title="解析本身是一张图（文字在图里）：搜不到、也改不了，先筛出来"
            >
              <input v-model="mediaOnlyFilter" type="checkbox" aria-label="只看解析只有图片" @change="search" />
              只看「解析只有图片」
            </label>
          </div>

          <!-- 选中后出现的批量操作条：不再需要一条条点 -->
          <div v-if="selectedCount > 0" class="bulk-bar">
            <span class="bulk-bar__count">已选 {{ selectedCount }} 题</span>
            <div class="mc-spacer" />
            <DropdownMenu
              :items="bulkDifficultyItems"
              label="批量改难度"
              :icon="null"
              variant="soft"
              :disabled="bulkBusy"
              @select="(key) => bulkSetDifficulty(key as 'easy' | 'medium' | 'hard')"
            />
            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" :disabled="bulkBusy" @click="bulkDelete">
              批量删除
            </button>
            <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="clearSelection">取消选择</button>
          </div>

          <EmptyState
            v-if="!selectedBank"
            icon="arrow-left"
            title="请先在左侧选择题库"
            description="选中题库后即可查看、编辑其中的题目，并导入导出 CSV。"
          />

          <div v-else-if="questionsLoading && questions.length === 0" class="loading">
            <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
          </div>

          <EmptyState
            v-else-if="questions.length === 0"
            icon="info"
            title="没有匹配的题目"
            description="可以调整筛选条件，或新建一道题目；也可以用 CSV 批量导入。"
            action-text="新建题目"
            @action="openCreateQuestion"
          />

          <template v-else>
            <!-- 键盘流：↑↓ 移动当前题、Enter 编辑、/ 聚焦搜索、Esc 取消 -->
            <div
              class="mc-table-wrap table-wrap"
              :class="{ 'table-wrap--compact': density === 'compact' }"
              tabindex="0"
              role="region"
              aria-label="题目表（上下键移动当前题，回车编辑，斜杠聚焦搜索）"
              @keydown="onTableKeydown"
              @click="tableWrap?.focus()"
            >
              <table class="mc-table mc-table--compact">
                <thead>
                  <tr>
                    <th class="col-check">
                      <label class="check-hit">
                        <input
                          type="checkbox"
                          aria-label="选中本页全部题目"
                          :checked="allOnPageSelected"
                          @change="toggleSelectAllOnPage"
                        />
                      </label>
                    </th>
                    <th class="col-no">序号</th>
                    <th>题干</th>
                    <th class="col-type">题型</th>
                    <th class="col-answer">答案</th>
                    <th class="col-ops">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(question, index) in questions"
                    :key="question.id"
                    :class="{
                      'row--selected': selectedIds.has(question.id),
                      'row--active': activeRow === index,
                    }"
                  >
                    <td class="col-check">
                      <label class="check-hit">
                        <input
                          type="checkbox"
                          :aria-label="`选中第 ${(page - 1) * pageSize + index + 1} 题`"
                          :checked="selectedIds.has(question.id)"
                          @change="toggleSelect(question.id)"
                        />
                      </label>
                    </td>
                    <td class="mc-mono col-no">{{ (page - 1) * pageSize + index + 1 }}</td>
                    <td>
                      <div class="stem" :class="{ 'stem--clamped': !isStemExpanded(question.id) }">
                        <RichText class="stem__text" :text="question.stem" />
                      </div>
                      <button
                        v-if="question.stem.length > 90"
                        class="stem__toggle"
                        type="button"
                        @click="toggleStem(question.id)"
                      >
                        {{ isStemExpanded(question.id) ? '收起' : '展开完整题干' }}
                      </button>
                      <!-- 次要信息（难度 / 知识点 / 册次）收进题干下方一行小字，可按偏好隐藏 -->
                      <div v-if="showMeta" class="stem__meta mc-row mc-row--wrap">
                        <span
                          class="diff-text"
                          :class="`diff-text--${question.difficulty ?? 'none'}`"
                          :title="difficultyTitle(question)"
                        >
                          难度 {{ difficultyLabel(question.difficulty) }}
                          <!-- 未评估时后端返回 -1，只在真正算过（>0）时显示分数 -->
                          <template v-if="(question.difficulty_score ?? -1) > 0">
                            · {{ Math.round(question.difficulty_score ?? 0) }}
                          </template>
                        </span>
                        <span v-if="question.point" class="mc-muted stem__meta-item">· {{ question.point }}</span>
                        <span v-if="question.book" class="mc-muted stem__meta-item">· {{ question.book }}</span>
                        <span v-if="question.options.length > 0" class="mc-muted stem__meta-item">
                          · {{ question.options.length }} 个选项
                        </span>
                      </div>
                    </td>
                    <td class="col-type">
                      <span class="mc-badge" :class="question.type === 'multiple' ? 'mc-badge--primary' : ''">
                        {{ TYPE_LABEL[question.type] }}
                      </span>
                    </td>
                    <td class="mc-mono col-answer">
                      <span class="answer-clamp" :title="answerText(question)">{{ answerText(question) }}</span>
                    </td>
                    <td class="col-ops">
                      <div class="row-actions">
                        <button class="mc-btn mc-btn--sm" type="button" @click="openEditQuestion(question)">
                          编辑
                        </button>
                        <button
                          class="mc-btn mc-btn--sm mc-btn--danger"
                          type="button"
                          @click="removeQuestion(question)"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="pager">
              <span class="mc-muted">共 {{ total }} 题 · 第 {{ page }} / {{ totalPages }} 页</span>
              <label class="pager__size">
                <span class="mc-muted">每页</span>
                <select v-model.number="pageSize" class="mc-select" aria-label="每页条数" @change="changePageSize">
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </label>
              <div class="mc-spacer" />
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1" @click="goPageTo(1)">首页</button>
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page <= 1" @click="goPage(-1)">上一页</button>
              <button class="mc-btn mc-btn--sm" type="button" :disabled="page >= totalPages" @click="goPage(1)">
                下一页
              </button>
              <button
                class="mc-btn mc-btn--sm"
                type="button"
                :disabled="page >= totalPages"
                @click="goPageTo(totalPages)"
              >
                末页
              </button>
            </div>
          </template>
        </div>
      </section>
    </div>

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      accept=".csv,.md,.markdown,.txt,.docx,text/csv,text/markdown"
      aria-hidden="true"
      tabindex="-1"
      @change="onImportFilePicked"
    />
    <input
      ref="qImageInput"
      class="hidden-input"
      type="file"
      accept="image/*"
      aria-hidden="true"
      tabindex="-1"
      @change="onQuestionImagePicked"
    />

    <!-- 重算难度（先预览再执行） -->
    <AppModal :open="diffOpen" title="重算难度" width="760px" @close="diffOpen = false">
      <div v-if="diffBusy && !diffPreview" class="loading"><div class="mc-skeleton loading__row" /></div>
      <div v-else-if="diffPreview" class="mc-col diff-preview">
        <label class="mc-row diff-preview__scope">
          <input v-model="diffScopeAll" type="checkbox" @change="loadDifficultyPreview" />
          <span>重算<strong>全库</strong>难度（当前{{ selectedBank ? `题库「${selectedBank.name}」` : '' }}）</span>
        </label>

        <p>
          将评估 <strong>{{ diffPreview.willScore }}</strong> 道题（共 {{ diffPreview.total }} 道）； 保留<strong
            >人工标注</strong
          >
          {{ diffPreview.skippedManual }} 道、<strong>已校准</strong> {{ diffPreview.skippedCalibrated }} 道不动。
        </p>
        <p class="mc-muted">
          判定方式（主流做法）：内容特征先验（学段年级、题型、算式与公式复杂度、小问数、题干阅读量、看图、高阶目标动词、
          卷型与知识点标注）→ 0–100 分 → 按**分位数**分档，保证结构合理。作答数据积累后会再做一次校准。
        </p>

        <div class="diff-preview__grid">
          <div>
            <div class="mc-label">算完之后的三档结构</div>
            <p v-for="b in diffPreview.predicted.buckets" :key="b.difficulty" class="mc-muted">
              {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }}：{{ b.questions }} 题（{{ b.ratio }}%）
            </p>
            <div class="mc-label">五级口径</div>
            <p v-for="l in diffPreview.predicted.levels" :key="l.level" class="mc-muted">
              {{ l.level }}★ {{ l.label }}：{{ l.questions }} 题（{{ l.ratio }}%）
            </p>
          </div>
          <div>
            <div class="mc-label">当前库里已有的</div>
            <p v-for="b in diffPreview.current.buckets" :key="b.difficulty" class="mc-muted">
              {{ DIFFICULTY_LABEL[b.difficulty] ?? b.difficulty }}：{{ b.questions }} 题
            </p>
            <p class="mc-muted">
              来源：
              <span v-for="s in diffPreview.current.sources" :key="s.source">
                {{ SOURCE_LABEL[s.source] ?? s.source }} {{ s.questions }}
              </span>
            </p>
            <p class="mc-muted">
              阈值：基础 &lt; {{ diffPreview.cuts.easyMax }} 分｜中档 &lt;
              {{ diffPreview.cuts.mediumMax }} 分｜其余为较难
            </p>
          </div>
        </div>

        <div class="mc-label">抽查：模型认为最容易 / 最难的题</div>
        <ul class="diff-preview__samples">
          <li v-for="s in diffPreview.samples.easiest" :key="`e${s.id}`">
            <span class="diff-preview__score">{{ s.score }}</span>
            <RichText class="stem__text" :text="s.stem" />
          </li>
          <li v-for="s in diffPreview.samples.hardest" :key="`h${s.id}`" class="diff-preview__sample--hard">
            <span class="diff-preview__score">{{ s.score }}</span>
            <RichText class="stem__text" :text="s.stem" />
            <span class="mc-muted">{{ s.reasons }}</span>
          </li>
        </ul>
      </div>

      <template #footer>
        <button class="mc-btn mc-btn--ghost" type="button" @click="diffOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="diffBusy" @click="applyDifficulty">
          {{ diffBusy ? '重算中…' : '确认重算' }}
        </button>
      </template>
    </AppModal>

    <!-- 清理重复题（先预览再执行） -->
    <AppModal :open="dedupeResult !== null" title="清理重复题" width="640px" @close="dedupeResult = null">
      <div v-if="dedupeResult" class="mc-col">
        <p>
          题库里发现 <strong>{{ dedupeResult.groups }}</strong> 组重复题，可合并
          <strong>{{ dedupeResult.removable }}</strong> 道（每组保留最早的一条）。
        </p>
        <p class="mc-muted">
          判定标准：题干与选项完全相同、<strong>答案也一致</strong>。同一题干但答案不同的题不会被自动删除，
          请在「题库体检」里单独核对。
        </p>
        <ul v-if="dedupeResult.samples.length > 0" class="dedupe-samples">
          <li v-for="(s, i) in dedupeResult.samples" :key="i">
            <RichText class="stem__text" :text="s.stem" />
            <span class="mc-muted">×{{ s.count }}</span>
          </li>
        </ul>
      </div>
      <template #footer>
        <button class="mc-btn" type="button" @click="dedupeResult = null">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="dedupeBusy" @click="applyDedupe">
          {{ dedupeBusy ? '合并中…' : '合并重复题' }}
        </button>
      </template>
    </AppModal>

    <!-- 整卷试卷 → 建考试 -->
    <AppModal :open="examOpen" title="用这份试卷建考试" width="560px" @close="examOpen = false">
      <div class="mc-col">
        <p class="mc-muted">
          把题库「{{ selectedBank?.name }}」的 {{ selectedBank?.question_count }} 道题按顺序生成一场考试。
        </p>
        <label class="mc-field">
          <span class="mc-label mc-label--required">挂到哪门课程</span>
          <select v-model="examForm.courseId" class="mc-select">
            <option value="">请选择课程</option>
            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="mc-field">
          <span class="mc-label">考试名称</span>
          <input v-model="examForm.title" class="mc-input" type="text" maxlength="100" />
        </label>
        <div class="form-grid">
          <label class="mc-field">
            <span class="mc-label">时长（分钟）</span>
            <input v-model.number="examForm.durationMinutes" class="mc-input" type="number" min="1" max="600" />
          </label>
          <label class="mc-field">
            <span class="mc-label">及格分</span>
            <input v-model.number="examForm.passScore" class="mc-input" type="number" min="0" max="100" />
          </label>
        </div>
        <label class="mc-row check">
          <input v-model="examForm.publish" type="checkbox" />
          <span>立即发布（学生能看到）</span>
        </label>
      </div>
      <template #footer>
        <button class="mc-btn" type="button" @click="examOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="examSaving" @click="createExamFromBank">
          {{ examSaving ? '生成中…' : '生成考试' }}
        </button>
      </template>
    </AppModal>

    <!-- 题库表单 -->
    <AppModal
      :open="bankFormOpen"
      :title="bankEditingId === null ? '新建题库' : '编辑题库'"
      @close="bankFormOpen = false"
    >
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">题库名称</span>
          <input
            v-model="bankForm.name"
            class="mc-input"
            type="text"
            maxlength="200"
            placeholder="例如：第 01 讲 课后练习"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">关联课时</span>
          <select v-model="bankForm.lessonId" class="mc-select">
            <option value="">不关联课时</option>
            <option v-for="lesson in courseLessonOptions" :key="lesson.id" :value="lesson.id">
              {{ lesson.title }}
            </option>
          </select>
          <span class="mc-hint">
            关联课时后，该题库会作为该课时的课后练习题目来源。列表来自左侧选中的课程
            {{ catalogCourseId === null ? '（请先在左侧选择课程）' : '（含章节分组）' }}。
          </span>
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="bankFormOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="bankSaving" @click="saveBank">
          {{ bankSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 题目编辑器 -->
    <AppModal :open="qOpen" :title="qEditingId === null ? '新建题目' : '编辑题目'" width="720px" @close="qOpen = false">
      <div class="mc-col">
        <div class="form-grid">
          <label class="mc-field">
            <span class="mc-label mc-label--required">题型</span>
            <select v-model="qForm.type" class="mc-select">
              <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ TYPE_LABEL[t] }}</option>
            </select>
          </label>

          <label class="mc-field">
            <span class="mc-label">排序</span>
            <input v-model.number="qForm.sort" class="mc-input" type="number" min="0" />
          </label>
        </div>

        <label class="mc-field">
          <span class="mc-label mc-label--required">题干</span>
          <textarea v-model="qForm.stem" class="mc-textarea" maxlength="4000" placeholder="请输入题目内容" />
        </label>

        <div class="mc-col image-block">
          <div class="mc-row mc-row--between mc-row--wrap">
            <span class="mc-label">题目配图</span>
            <button class="mc-btn mc-btn--sm" type="button" @click="pickQuestionImage">
              {{ qImagePath ? '更换配图' : '上传配图' }}
            </button>
          </div>
          <img
            v-if="qImagePath && qEditingId !== null"
            class="image-block__preview"
            :src="`/api/v1/question-images/${qEditingId}`"
            alt="题目配图预览"
          />
          <span v-else class="mc-hint">
            {{ qEditingId === null ? '题目保存后即可上传配图。' : '当前没有配图，支持 jpg / png / gif / webp。' }}
          </span>
        </div>

        <template v-if="isChoice">
          <div class="mc-col">
            <div class="mc-row mc-row--between">
              <span class="mc-label mc-label--required">
                {{ qForm.type === 'single' ? '选项（单选：勾选唯一正确答案）' : '选项（多选：勾选全部正确答案）' }}
              </span>
              <button class="mc-btn mc-btn--sm" type="button" @click="addOption">添加选项</button>
            </div>

            <div v-for="(option, oi) in qForm.options" :key="oi" class="option-row">
              <label v-if="qForm.type === 'single'" class="option-row__pick">
                <input v-model="qForm.singleAnswer" type="radio" name="q-answer" :value="oi" />
                <span class="option-row__letter">{{ letter(oi) }}</span>
              </label>
              <label v-else class="option-row__pick">
                <input v-model="qForm.multipleAnswer" type="checkbox" :value="oi" />
                <span class="option-row__letter">{{ letter(oi) }}</span>
              </label>

              <input
                v-model="option.text"
                class="mc-input"
                type="text"
                maxlength="1000"
                :placeholder="`选项 ${letter(oi)} 内容`"
              />

              <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="removeOption(oi)">删除</button>
            </div>
          </div>
        </template>

        <template v-else-if="qForm.type === 'judge'">
          <div class="mc-field">
            <span class="mc-label mc-label--required">正确答案</span>
            <div class="mc-row judge-row">
              <label class="mc-checkbox">
                <input v-model="qForm.judgeAnswer" type="radio" name="q-judge" value="T" />
                对
              </label>
              <label class="mc-checkbox">
                <input v-model="qForm.judgeAnswer" type="radio" name="q-judge" value="F" />
                错
              </label>
            </div>
          </div>
        </template>

        <label v-else-if="qForm.type === 'fill'" class="mc-field">
          <span class="mc-label mc-label--required">填空答案</span>
          <input
            v-model="qForm.textAnswer"
            class="mc-input"
            type="text"
            maxlength="2000"
            placeholder="多个可接受答案用 | 分隔，例如：final|final 关键字"
          />
          <span class="mc-hint">学生填写其中任意一个即判为正确。</span>
        </label>

        <label v-else class="mc-field">
          <span class="mc-label mc-label--required">参考答案</span>
          <textarea
            v-model="qForm.textAnswer"
            class="mc-textarea"
            maxlength="2000"
            placeholder="简答题不自动判分，此处填写参考要点供学生自评"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">解析</span>
          <textarea
            v-model="qForm.analysis"
            class="mc-textarea"
            maxlength="4000"
            placeholder="讲解为什么选这个答案（可选）"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">难度</span>
          <select v-model="qForm.difficulty" class="mc-select">
            <option value="">自动判定（推荐）</option>
            <option value="easy">基础</option>
            <option value="medium">中等</option>
            <option value="hard">较难</option>
          </select>
          <span class="mc-hint">
            「自动判定」由难度模型按内容特征打分（学段年级、题型、算式与公式复杂度、小问数、阅读量、看图、高阶目标），
            并按分位数分成三档/五级；手动选择会记为<strong>人工标注</strong>，之后的自动重算不会覆盖。
          </span>
        </label>

        <p v-if="qEditingId !== null" class="mc-muted">
          当前难度：
          <DifficultyBadge
            :score="questions.find((q) => q.id === qEditingId)?.difficulty_score"
            :difficulty="questions.find((q) => q.id === qEditingId)?.difficulty"
            :source="questions.find((q) => q.id === qEditingId)?.difficulty_source"
            :samples="questions.find((q) => q.id === qEditingId)?.difficulty_n"
          />
        </p>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="qOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="qSaving" @click="saveQuestion">
          {{ qSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>

    <!-- 导入结果 -->
    <AppModal :open="importResult !== null" title="导入结果" width="600px" @close="importResult = null">
      <div v-if="importResult" class="mc-col">
        <div class="mc-row mc-row--wrap">
          <span class="mc-badge mc-badge--success">成功导入 {{ importResult.inserted }} 题</span>
          <span class="mc-badge" :class="importResult.errors.length > 0 ? 'mc-badge--danger' : ''">
            未导入 {{ importResult.errors.length }} 题
          </span>
        </div>

        <p v-if="importResult.errors.length === 0" class="mc-hint">全部题目都导入成功。</p>

        <ul v-else class="error-list">
          <li v-for="(msg, i) in importResult.errors" :key="i" class="error-list__item">{{ msg }}</li>
        </ul>

        <template v-if="importResult.warnings.length > 0">
          <span class="mc-label">需要注意</span>
          <ul class="error-list error-list--warn">
            <li v-for="(msg, i) in importResult.warnings" :key="i" class="error-list__item">{{ msg }}</li>
          </ul>
        </template>

        <span class="mc-hint import-help">
          支持 CSV（Excel）、Markdown（.md/.txt）与 Word（.docx）。Markdown / Word 的写法：题型行（如
          <code>### 1. 单选题</code>）→ 题干 → <code>A. 选项</code> → <code>答案：B</code> →
          <code>解析：…</code>；<strong>Word 里的配图会自动导入成题目配图</strong>。可先下载模板照着写。
        </span>
      </div>

      <template #footer>
        <button class="mc-btn mc-btn--primary" type="button" @click="importResult = null">知道了</button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.metric__link {
  margin-left: 8px;
  color: var(--mc-primary-fg);
  white-space: nowrap;
}

/* 可点击的指标链接（不是路由跳转，而是把左侧列表按该条件筛出来） */
.metric__link--btn {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

/* 需要教师处理的数据质量问题，给一点提示色 */
.metric--warn .metric__value {
  color: var(--mc-warning-fg);
}

/* ---- 题库目录树（课程 → 章节 → 小节 → 题库） ---- */
.tree {
  border-bottom: 1px solid var(--mc-border);
  max-height: 46vh;
  overflow-y: auto;
  padding: var(--mc-space-2) var(--mc-space-3);
}

.tree__hint {
  flex: 1 1 100%;
  font-size: var(--mc-text-xs);
  white-space: normal;
}

.tree__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
  padding-bottom: var(--mc-space-2);
}

.tree__search {
  /* 占满一整行：左栏窄，搜索框和类型下拉并排会把两边都挤到看不清 */
  flex: 1 1 100%;
  min-width: 0;
}

.tree__kind {
  flex: 1 1 120px;
  max-width: 100%;
}

/* 册次行的「挂到课程」：默认低调，悬停该行才显现 */
.nav-item__bind {
  flex: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.nav-item:hover .nav-item__bind,
.nav-item:focus-within .nav-item__bind {
  opacity: 1;
}

@media (hover: none) {
  .nav-item__bind {
    opacity: 1;
  }
}

.bindbook {
  gap: var(--mc-space-3);
}

.bindbook__lead {
  margin: 0;
  font-size: var(--mc-text-base);
}

.bindbook__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
}

/* 左栏：逐级下钻导航（课程 → 题库），替代原来的巨型课程树 */
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  max-height: 46vh;
  overflow: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px;
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  font-size: var(--mc-text-sm);
}

.nav-item:hover {
  background: var(--mc-surface-2);
}

.nav-item__meta {
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.nav-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--mc-text-sm);
}

.nav-crumb__back {
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  color: var(--mc-text);
  font-size: var(--mc-text-xs);
  cursor: pointer;
}

.nav-crumb__back:hover {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
}

/* 最近打开的题库：一键回到常去的库 */

/* 课程树折叠开关：默认收起，让左栏把空间留给"可搜索的题库列表" */

/* ============ 版式设计：指标卡 + 卡片化面板 + 表格排版 ============ */

/* 指标卡片行：先给"全局规模"，再进具体操作 */

/* 题型/难度 chip 组：一眼看到全部可选值，少一次点击 */
.chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--mc-space-1);
}

.chip {
  min-height: 32px;
  padding: 8px 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
  cursor: pointer;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--mc-primary-border);
  color: var(--mc-primary-fg);
}

.chip--active {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

/* 行内操作：默认隐形，鼠标移到行上才出现（常显会让表格很吵、也容易误点删除） */
/* 批量操作条：选中后从筛选行下方滑出（用背景色区分"操作态"） */
.bulk-bar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
}

.bulk-bar__count {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  color: var(--mc-primary-fg);
}

/* 复选框列：窄列 + 居中 */
.col-check {
  width: 40px;
  text-align: center;
}

/* 复选框本身只有 16px，把整个单元格做成点击区（触屏也能点准） */
.col-check {
  cursor: pointer;
}

/* 复选框本体只有 18px：用 label 撑出 32×32 的命中区，触屏也能点准 */
.check-hit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  cursor: pointer;
}

.col-check input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.row--selected td {
  background: var(--mc-primary-soft);
}

/* 键盘流高亮：↑↓ 移动时能看清当前在哪一题 */
.row--active td {
  box-shadow: inset 3px 0 0 var(--mc-primary);
  background: var(--mc-surface-2);
}

/* 行密度偏好：紧凑模式压掉内边距，一屏多看几题 */
.table-wrap--compact :deep(td),
.table-wrap--compact td {
  padding-top: var(--mc-space-1);
  padding-bottom: var(--mc-space-1);
}

/* 难度：可读文字 + 颜色分级（原来显示 ★★★☆☆ 56 模型，用户根本不知道是什么） */
.diff-text {
  padding: 1px 8px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-surface-2);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.diff-text--easy {
  background: var(--mc-success-soft, var(--mc-surface-2));
  color: var(--mc-success, var(--mc-text-secondary));
}

.diff-text--hard {
  background: var(--mc-warning-soft, var(--mc-surface-2));
  color: var(--mc-warning, var(--mc-text-secondary));
}

.diff-text--none {
  color: var(--mc-text-muted);
}

/* 行内操作：**默认可见**（触摸屏/键盘必须能触达），只有在支持悬停的精确指针设备上
   才收起、悬停或聚焦时显现——审计发现触摸环境下 opacity 恒为 0，编辑/删除根本点不到 */
.row-actions {
  display: flex;
  gap: var(--mc-space-1);
  opacity: 1;
  transition: opacity 0.12s ease;
}

@media (hover: hover) and (pointer: fine) {
  .row-actions {
    opacity: 0;
  }

  .question-panel .mc-table tbody tr:hover .row-actions,
  .question-panel .mc-table tbody tr:focus-within .row-actions {
    opacity: 1;
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elev, transparent);
  color: var(--mc-text-secondary);
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
}

.icon-btn--danger:hover {
  border-color: var(--mc-danger, var(--mc-primary));
  color: var(--mc-danger, var(--mc-primary));
}

/* 答案列：长答案（填空/解答）限 2 行，悬停看全文 */
.answer-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.pager {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.pager__size {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-sm);
}

.kpi {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--mc-space-4);
}

.kpi__card {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-4) var(--mc-space-5);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elev, var(--mc-surface-2));
  box-shadow: var(--mc-shadow-xs);
  text-align: left;
}

.kpi__card--action {
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.kpi__card--action:hover {
  border-color: var(--mc-primary-border);
  background: var(--mc-primary-soft);
}

.kpi__label {
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
}

.kpi__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-display);
  font-variant-numeric: tabular-nums;
}

.kpi__sub {
  font-size: var(--mc-text-xs);
}

/* 左栏：卡片化导航，头部吸附、行高统一 */
.bank-panel {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 220px);
  padding: 0;
  overflow: hidden;
}

.bank-panel .mc-card__header {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-3);
  background: var(--mc-bg-elev, var(--mc-surface-2));
  border-bottom: 1px solid var(--mc-border);
}

.bank-panel .tree__toolbar {
  padding: var(--mc-space-3) var(--mc-space-4) var(--mc-space-2);
  margin: 0;
}

.bank-panel__listhead {
  align-items: center;
  gap: var(--mc-space-2);
}

.bank-panel__sort {
  max-width: 108px;
  height: 28px;
  padding: 0 var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.bank-panel__list {
  padding: 0 var(--mc-space-3) var(--mc-space-3);
  overflow: auto;
}

.bank-item {
  padding: var(--mc-space-3) var(--mc-space-3);
  border-radius: var(--mc-radius);
  min-height: 44px;
}

.bank-item--active {
  background: var(--mc-primary-soft);
  border-left-color: var(--mc-primary);
}

/* 题库名两行显示：审计发现长名字被单行截断且没有 title，信息等于丢失 */
.bank-item__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-medium);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  line-height: var(--mc-leading-snug);
}

.bank-item__meta {
  font-size: var(--mc-text-xs);
}

.nav-item {
  min-height: 42px;
  padding: var(--mc-space-3) var(--mc-space-3);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-base);
}

.nav-item__meta {
  font-variant-numeric: tabular-nums;
}

/* 右栏：题库头部 + 工具条 + 表格 */
.question-panel {
  padding: 0;
  overflow: hidden;
}

.question-panel .mc-card__header {
  gap: var(--mc-space-3);
  padding: var(--mc-space-4) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
}

.bank-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
  flex-wrap: wrap;
}

.bank-head__title {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-3);
  min-width: 0;
  flex: 1 1 260px;
}

.bank-head__name {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  min-width: 0;
}

.bank-head__count {
  font-size: var(--mc-text-sm);
  white-space: nowrap;
}

.bank-head__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: nowrap;
}

.question-panel .mc-card__body {
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-5);
  gap: var(--mc-space-4);
}

.filters {
  gap: var(--mc-space-2);
  padding-bottom: var(--mc-space-2);
  border-bottom: 1px solid var(--mc-border);
}

.filters__keyword {
  flex: 1 1 240px;
}

.question-panel .mc-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--mc-space-3) var(--mc-space-3);
  background: var(--mc-bg-elev, var(--mc-surface-2));
  border-bottom: 1px solid var(--mc-border-strong);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text-muted);
  letter-spacing: 0.02em;
  text-align: left;
}

.question-panel .mc-table tbody td {
  padding: var(--mc-space-3);
  border-bottom: 1px solid var(--mc-border);
  vertical-align: top;
}

.question-panel .mc-table tbody tr:hover {
  background: var(--mc-surface-2);
}

.question-panel .mc-table tbody tr:last-child td {
  border-bottom: 0;
}

.col-answer {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
}

.pager {
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
}

.bank-panel__tree-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 8px;
  margin-bottom: 8px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-surface-2);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
  cursor: pointer;
  text-align: left;
}

.bank-panel__tree-toggle:hover {
  color: var(--mc-text);
  border-color: var(--mc-border-strong, var(--mc-border));
}

/* 题干限 3 行（可展开）：一屏能多看几道题，长材料题也不至于把表格撑爆 */
.stem--clamped .stem__text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.stem__toggle {
  margin-top: 4px;
  min-height: 24px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  cursor: pointer;
}

.bank-panel__more {
  width: 100%;
  margin-top: 8px;
}

/* 题干下方的次要信息行（难度 / 知识点 / 册次 / 选项数） */
.stem__meta {
  margin-top: 4px;
  gap: 8px;
  font-size: var(--mc-text-xs);
}

.stem__meta-item {
  white-space: nowrap;
}

/* 题目表列宽：题干吃满剩余宽度，其余列紧凑 */
.col-no {
  width: 44px;
}

.col-type {
  width: 92px;
  white-space: nowrap;
}

.col-answer {
  width: 148px;
  white-space: pre-wrap;
  word-break: break-word;
}

.col-ops {
  width: 124px;
  white-space: nowrap;
}

.filters__more {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  gap: 8px;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
  cursor: pointer;
}

.tree__children {
  margin-left: 4px;
  border-left: 1px dashed var(--mc-border);
}

.tree__hint {
  font-size: var(--mc-text-xs);
  padding: var(--mc-space-1) var(--mc-space-2) var(--mc-space-1) 24px;
}

.tree__bank {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--mc-space-1) var(--mc-space-2) var(--mc-space-1) 32px;
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  font-size: var(--mc-text-sm);
}

.tree__bank:hover {
  background: var(--mc-surface-2);
}

.tree__bank--active {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.tree__rebind {
  margin: var(--mc-space-2) 0 0 8px;
}

.bank-panel__list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.bank-panel__listhead {
  padding: var(--mc-space-2) var(--mc-space-3);
  border-bottom: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
}

.bank-panel__listhead .mc-muted {
  flex: 1;
  min-width: 0;
}

.bank-list {
  overflow-y: auto;
  max-height: 42vh;
}

.toolbar__course {
  max-width: 200px;
}

.bank-item__bind {
  max-width: 130px;
  font-size: var(--mc-text-xs);
}

.difficulty-panel {
  gap: var(--mc-space-2);
  padding-top: var(--mc-space-3);
  border-top: 1px dashed var(--mc-border);
}

.difficulty-panel__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.difficulty-panel__head .mc-card__title {
  margin-right: auto;
}

.diff-preview {
  gap: var(--mc-space-3);
}

.diff-preview__scope {
  gap: var(--mc-space-2);
  align-items: center;
}

.diff-preview__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mc-space-4);
}

.diff-preview__samples {
  margin: 0;
  padding-left: 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diff-preview__samples li {
  display: flex;
  gap: var(--mc-space-2);
  align-items: baseline;
}

.diff-preview__score {
  min-width: 32px;
  font-variant-numeric: tabular-nums;
  color: var(--mc-text-secondary, inherit);
}

.diff-preview__sample--hard .diff-preview__score {
  color: var(--mc-danger-fg);
  font-weight: var(--mc-font-semibold);
}

.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.toolbar__pick {
  gap: var(--mc-space-2);
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

.layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: var(--mc-space-5);
  align-items: start;
}

@media (max-width: 1180px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.bank-panel {
  position: sticky;
  top: var(--mc-space-5);
}

.bank-panel__loading,
.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
}

.loading__row {
  height: 44px;
}

.bank-list {
  margin: 0;
  padding: var(--mc-space-2);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  max-height: 64vh;
  overflow-y: auto;
}

.bank-item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  cursor: pointer;
  transition: background var(--mc-transition);
}

.bank-item:hover {
  background: var(--mc-bg-hover);
}

.bank-item--active {
  background: var(--mc-primary-soft);
}

.bank-item__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.bank-item__name {
  font-weight: var(--mc-font-medium);
  font-size: var(--mc-text-sm);
}

.bank-item__meta {
  font-size: var(--mc-text-xs);
}

.bank-item__actions {
  display: none;
  gap: var(--mc-space-1);
}

.bank-item:hover .bank-item__actions,
.bank-item--active .bank-item__actions {
  display: flex;
}

.question-panel {
  min-width: 0;
}

.filters__type {
  width: 150px;
}

.filters__keyword {
  width: 260px;
}

/* 整行 label 都是点击区：复选框本身只有 13px，手指点不准 */
.filters__check {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: 0.9em;
  color: var(--mc-text-muted);
  white-space: nowrap;
  cursor: pointer;
}

.table-wrap {
  max-height: 52vh;
  overflow: auto;
}

.stem {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 260px;
  max-width: 520px;
}

.stem__image {
  flex: none;
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.meta-cell {
  display: flex;
  flex-direction: column;
  max-width: 220px;
  font-size: var(--mc-font-sm);
}

.meta-cell__sub {
  font-size: var(--mc-font-xs);
}

.dedupe-samples {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding-left: var(--mc-space-4);
  font-size: var(--mc-font-sm);
}

.dedupe-samples li {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
}

.pager {
  gap: var(--mc-space-2);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: var(--mc-space-4);
}

.option-row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.option-row__pick {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  cursor: pointer;
  flex: none;
}

.option-row__letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
}

.judge-row {
  gap: var(--mc-space-5);
}

.image-block {
  padding: var(--mc-space-3);
  border: 1px dashed var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.image-block__preview {
  max-width: 100%;
  max-height: 200px;
  align-self: flex-start;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border);
}

.hidden-input {
  display: none;
}

.error-list {
  margin: 0;
  padding: var(--mc-space-3) var(--mc-space-3) var(--mc-space-3) var(--mc-space-6);
  list-style: disc;
  max-height: 260px;
  overflow-y: auto;
  border-radius: var(--mc-radius);
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
  font-size: var(--mc-text-sm);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.error-list__item {
  word-break: break-all;
}

/* 提示类（可以导入、但需要老师留意，如被忽略的图片链接） */
.error-list--warn {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.import-help code {
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius);
  padding: 0 4px;
  font-size: var(--mc-text-xs);
}

@media (max-width: 1080px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .bank-panel {
    position: static;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
