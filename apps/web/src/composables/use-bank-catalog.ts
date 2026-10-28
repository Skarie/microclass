/**
 * 题库目录编排：左侧两视图（文件夹树 / 课程关联）→ 题库列表范围。
 *
 * - 文件夹与课程侧分别落在 use-bank-folders / use-bank-courses；
 * - 题库列表（搜索/排序/分页/选中）在 use-bank-list；
 * - 这里只负责三者之间的联动（切视图、选文件夹/课程、面包屑、计数）。
 */
import { computed, ref, watch } from 'vue';
import { useBankList, type BankKindFilter, type BankListDeps } from '@/composables/use-bank-list';
import { useBankFolders } from '@/composables/use-bank-folders';
import { useBankCourses } from '@/composables/use-bank-courses';
import { useBankCourseDetail } from '@/composables/use-bank-course-detail';
import { useBankRebind } from '@/composables/use-bank-rebind';
import {
  bankCourseId,
  bankCourseName,
  type BankNavView,
  type CourseFilter,
  type FolderFilter,
} from '@/views/admin/bankTypes';
import type { Bank } from '@/api/types';

const NAV_VIEW_KEY = 'mc.banks.navView';

/** 读上次选择的目录视图；隐私模式禁用 localStorage 时退回「题库」 */
function storedNavView(): BankNavView {
  try {
    return localStorage.getItem(NAV_VIEW_KEY) === 'course' ? 'course' : 'folder';
  } catch {
    return 'folder';
  }
}

export type BankCatalogDeps = BankListDeps;

export function useBankCatalog(deps: BankCatalogDeps) {
  const navView = ref<BankNavView>(storedNavView());
  const kindFilter = ref<BankKindFilter>('');
  const bankKeyword = ref('');
  const searchActive = computed(() => bankKeyword.value.trim() !== '');

  watch(
    navView,
    (view) => {
      try {
        localStorage.setItem(NAV_VIEW_KEY, view);
      } catch {
        /* 浏览器禁用存储时只影响下次打开，不影响当前页面 */
      }
    },
    // 首次进入也把默认视图写下来，下次打开/跨标签页读到的是明确值而不是 null
    { immediate: true },
  );

  /** 文件夹 CRUD 需要刷新列表，列表创建后回填（打破循环依赖） */
  let reloadBanks = async (): Promise<void> => {};
  const folders = useBankFolders({ reloadBanks: () => reloadBanks() });
  const courses = useBankCourses();

  const bankList = useBankList(
    {
      kindFilter,
      bankKeyword,
      navView,
      folderFilter: folders.selectedFolder,
      courseFilter: courses.selectedCourse,
    },
    deps,
  );
  reloadBanks = () => bankList.loadBanks(false);

  const courseDetail = useBankCourseDetail();
  const refreshNav = async (): Promise<void> => {
    await Promise.all([folders.loadFolders(), courses.loadCourseSummary()]);
  };
  const rebindApi = useBankRebind({
    loadBanks: () => bankList.loadBanks(),
    refreshNav,
  });

  /** 课程关联视图只统计有题库的课程 + 未关联 */
  const binding = computed(() => {
    const bound = courses.courses.value.reduce((sum, course) => sum + course.bankCount, 0);
    const unbound = courses.unboundCourses.value.bankCount;
    return { bound, unbound, banks: bound + unbound };
  });

  const navCountLabel = computed(() =>
    navView.value === 'folder'
      ? `${folders.folderCount.value} 个文件夹 · ${folders.folderBankTotal.value} 个题库`
      : `${courses.courses.value.length} 门课程 · ${binding.value.unbound} 个未关联`,
  );

  /** 题库列表的返回条：搜索优先，否则回到「全部题库」 */
  const crumbBackLabel = computed(() => {
    if (searchActive.value) return '← 清除搜索';
    return navView.value === 'folder' ? '← 全部题库' : '← 全部课程';
  });
  const crumbPath = computed(() => {
    if (searchActive.value) return ` / 搜索：${bankKeyword.value}`;
    if (navView.value === 'folder') {
      return folders.selectedFolder.value === 'all' ? '' : ` / ${folders.selectedFolderName.value}`;
    }
    return courses.selectedCourse.value === 'all' ? '' : ` / ${courses.selectedCourseName.value}`;
  });

  /** 新建题库时的默认文件夹：当前正浏览某个具体文件夹才带出 */
  const currentFolderId = computed(() =>
    navView.value === 'folder' && typeof folders.selectedFolder.value === 'number'
      ? folders.selectedFolder.value
      : null,
  );

  /** 详情面板 / 表单用：接口没回 course_id 时按课程名反查 */
  function courseIdOfBank(bank: Bank): number | null {
    return bankCourseId(bank) ?? courses.findCourseIdByName(bankCourseName(bank));
  }

  /** 选中题库后顺手把它的课程课时拉出来，编辑表单的「关联课时」才有选项 */
  watch(bankList.selectedBank, (bank) => {
    if (!bank) return;
    const courseId = courseIdOfBank(bank);
    if (courseId === null) return;
    if (courseDetail.catalogCourseDetail.value?.course?.id === courseId) return;
    void courseDetail.loadCatalogCourse(courseId);
  });

  watch(kindFilter, () => {
    void bankList.loadBanks(false);
  });

  async function switchNavView(view: BankNavView): Promise<void> {
    if (navView.value === view) return;
    navView.value = view;
    if (view === 'course') await courses.loadCourseSummary();
    else await folders.loadFolders();
    await bankList.loadBanks(false);
  }

  async function pickFolder(filter: FolderFilter): Promise<void> {
    navView.value = 'folder';
    folders.selectFolder(filter);
    await bankList.loadBanks(false);
  }

  async function pickCourse(filter: CourseFilter): Promise<void> {
    navView.value = 'course';
    courses.selectCourse(filter);
    if (typeof filter === 'number') await courseDetail.loadCatalogCourse(filter);
    else courseDetail.catalogCourseDetail.value = null;
    await bankList.loadBanks(false);
  }

  async function backFromBanks(): Promise<void> {
    if (searchActive.value) {
      bankKeyword.value = '';
      await bankList.loadBanks(false);
      return;
    }
    if (navView.value === 'folder') folders.selectFolder('all');
    else courses.selectCourse('all');
    await bankList.loadBanks(false);
  }

  return {
    // 视图与筛选
    navView,
    kindFilter,
    bankKeyword,
    searchActive,
    switchNavView,
    binding,
    navCountLabel,
    crumbBackLabel,
    crumbPath,
    currentFolderId,
    // 题库列表（use-bank-list，保持原有对外形状）
    ...bankList,
    // 文件夹树 / 课程关联
    ...folders,
    ...courses,
    // 课程详情（关联课时下拉）与自动匹配
    ...courseDetail,
    ...rebindApi,
    // 操作
    refreshNav,
    backFromBanks,
    loadBanks: bankList.loadBanks,
    loadFolders: folders.loadFolders,
    loadCourseSummary: courses.loadCourseSummary,
    pickFolder,
    pickCourse,
    courseIdOfBank,
  };
}
