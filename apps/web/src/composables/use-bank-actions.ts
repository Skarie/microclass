/**
 * 题库级操作：建/改/删题库、重算难度、清理重复题、整卷建考试、题库体检、
 * 按册次挂课程，以及题库详情区的两个下拉菜单。
 *
 * 从 BankAdminView 抽出。选中的题库、题库/题目列表的刷新、导出与模板下载由参数注入。
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { BankHealth, DedupeResult, DifficultyPreview } from '@/views/admin/bankTypes';

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

interface DifficultyApplyResult {
  scored: number;
  updated: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: { easyMax: number; mediumMax: number };
  buckets: { difficulty: string; questions: number }[];
}

interface CourseOption {
  id: number;
  name: string;
}

interface ExamForm {
  courseId: number | '';
  title: string;
  durationMinutes: number;
  passScore: number;
  publish: boolean;
}

export interface BankActionDeps {
  selectedBankId: Ref<number | null>;
  selectedBank: ComputedRef<Bank | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  loadQuestions: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  downloadTemplate: (kind: 'csv' | 'md') => Promise<void>;
  exportBank: (format: 'csv' | 'md' | 'docx', withAnswers?: boolean) => Promise<void>;
}

export function useBankActions(deps: BankActionDeps) {
  const toast = useToastStore();

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
        deps.selectedBankId.value = res.id;
        await deps.loadBanks();
      } else {
        await api.put<OkResponse>(`/banks/${bankEditingId.value}`, payload);
        toast.success(`题库「${name}」已保存`);
        bankFormOpen.value = false;
        await deps.loadBanks();
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
      if (deps.selectedBankId.value === bank.id) deps.selectedBankId.value = null;
      await deps.loadBanks(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /* ---------------- 题库内去重（标准化） ---------------- */
  const dedupeBusy = ref(false);
  const dedupeResult = ref<DedupeResult | null>(null);

  async function previewDedupe(): Promise<void> {
    // 两层弹窗叠着时，后开弹窗的按钮会被前一层遮罩拦截，先关掉体检弹窗
    healthOpen.value = false;
    const bank = deps.selectedBank.value;
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
    const bank = deps.selectedBank.value;
    if (!bank) return;
    dedupeBusy.value = true;
    try {
      const res = await api.post<DedupeResult>(`/banks/${bank.id}/dedupe`, { dryRun: false });
      toast.success(`已合并 ${res.removed} 道重复题（涉及 ${res.groups} 组）`);
      dedupeResult.value = null;
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      dedupeBusy.value = false;
    }
  }

  /* ---------------- 难度重算（内容特征先验 + 作答校准） ---------------- */
  const diffOpen = ref(false);
  const diffBusy = ref(false);
  const diffPreview = ref<DifficultyPreview | null>(null);
  /** 全库重算（不限于当前题库）：量大，默认勾选也只在老师点确认后执行 */
  const diffScopeAll = ref(false);

  async function openDifficulty(): Promise<void> {
    // 两层弹窗叠着时，后开弹窗的按钮会被前一层遮罩拦截，先关掉体检弹窗
    healthOpen.value = false;
    diffOpen.value = true;
    await loadDifficultyPreview();
  }

  async function loadDifficultyPreview(): Promise<void> {
    diffBusy.value = true;
    diffPreview.value = null;
    try {
      const query = diffScopeAll.value || !deps.selectedBank.value ? '' : `?bankId=${deps.selectedBank.value.id}`;
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
      const scope = diffScopeAll.value || !deps.selectedBank.value ? '' : `?bankId=${deps.selectedBank.value.id}`;
      const res = await api.post<DifficultyApplyResult>(`/questions/difficulty/apply${scope}`);
      toast.success(
        `已重算 ${res.updated} 道题的难度（保留人工 ${res.skippedManual} 道 / 已校准 ${res.skippedCalibrated} 道）`,
      );
      diffOpen.value = false;
      await deps.loadBanks();
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
      await deps.loadBanks();
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
  const courses = ref<CourseOption[]>([]);
  const examForm = reactive<ExamForm>({ courseId: '', title: '', durationMinutes: 60, passScore: 60, publish: true });

  async function loadCourses(): Promise<void> {
    try {
      const res = await api.get<{ courses: CourseOption[] }>('/courses');
      courses.value = res.courses;
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function openExamFromBank(): void {
    // 两层弹窗叠着时，后开弹窗的按钮会被前一层遮罩拦截，先关掉体检弹窗
    healthOpen.value = false;
    if (!deps.selectedBank.value) return;
    examForm.courseId = courses.value[0]?.id ?? '';
    examForm.title = deps.selectedBank.value.name;
    examForm.durationMinutes = 60;
    examForm.passScore = 60;
    examForm.publish = true;
    examOpen.value = true;
  }

  async function createExamFromBank(): Promise<void> {
    const bank = deps.selectedBank.value;
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
  const healthOpen = ref(false);
  const healthLoading = ref(false);
  const health = ref<BankHealth | null>(null);

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

  /* ---------------- 按册次批量挂课程 ---------------- */
  /** 选中的册次与目标课程 */
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
      await deps.loadCatalog();
      await deps.loadBanks(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bindingBook.value = false;
    }
  }

  /* ---------------- 题库详情区菜单 ---------------- */
  /**
   * 题库详情区的次要操作菜单。
   * 之前这里是 8 个同权重按钮并排（主次不分），现在只留「导入题目 / 新建题目」，
   * 导出与整卷相关操作收进「导出 / 更多」。
   */
  const bankMenuItems = computed<MenuItem[]>(() => [
    {
      key: 'export-csv',
      label: '导出 CSV',
      icon: 'download',
      hint: 'Excel 继续编辑',
      disabled: !deps.selectedBank.value,
    },
    {
      key: 'export-md',
      label: '导出 Markdown',
      icon: 'download',
      hint: '可贴进笔记软件',
      disabled: !deps.selectedBank.value,
    },
    {
      key: 'export-docx',
      label: '导出 Word（含答案）',
      icon: 'print',
      hint: '打印发给教研组',
      disabled: !deps.selectedBank.value,
    },
    {
      key: 'export-docx-blank',
      label: 'Word 试卷（不含答案）',
      icon: 'print',
      hint: '直接发给学生',
      disabled: !deps.selectedBank.value,
    },
    {
      key: 'exam',
      label: '用这份试卷建考试',
      icon: 'exam',
      hint: '按题目顺序生成考试',
      disabled: !deps.selectedBank.value || deps.selectedBank.value.kind !== 'paper',
    },
    {
      key: 'template-csv',
      label: '下载 CSV 模板',
      icon: 'download',
      hint: '按模板填好后再导入',
    },
    {
      key: 'template-md',
      label: '下载 Markdown 模板',
      icon: 'download',
    },
    {
      key: 'dedupe',
      label: '清理重复题',
      icon: 'copy',
      hint: '题干+选项+答案一致才合并',
      disabled: !deps.selectedBank.value || dedupeBusy.value,
    },
  ]);

  /**
   * 题库列表里每一行的「⋯」菜单。
   *
   * 设计取舍：左栏每个题库行都常显 3 个按钮（重命名 / 删除），
   * 300 行就是 900 个按钮 —— 又挤又容易误点删除。
   * 现在行内只保留名称与题量，操作收进选中/悬停才出现的菜单。
   */
  function bankRowMenuItems(): MenuItem[] {
    return [
      { key: 'rename', label: '重命名', icon: 'edit' },
      { key: 'delete', label: '删除题库', icon: 'trash', danger: true },
    ];
  }

  function onBankRowMenu(bank: Bank, key: string): void {
    if (key === 'rename') openEditBank(bank);
    else if (key === 'delete') void removeBank(bank);
  }

  function onBankMenuSelect(key: string): void {
    switch (key) {
      case 'template-csv':
        void deps.downloadTemplate('csv');
        break;
      case 'template-md':
        void deps.downloadTemplate('md');
        break;
      case 'export-csv':
        void deps.exportBank('csv');
        break;
      case 'export-md':
        void deps.exportBank('md');
        break;
      case 'export-docx':
        void deps.exportBank('docx');
        break;
      case 'export-docx-blank':
        void deps.exportBank('docx', false);
        break;
      case 'exam':
        openExamFromBank();
        break;
      case 'dedupe':
        void previewDedupe();
        break;
    }
  }

  return {
    // 题库表单
    bankFormOpen,
    bankSaving,
    bankEditingId,
    bankForm,
    openCreateBank,
    openEditBank,
    saveBank,
    removeBank,
    // 去重
    dedupeBusy,
    dedupeResult,
    previewDedupe,
    applyDedupe,
    // 难度重算
    diffOpen,
    diffBusy,
    diffPreview,
    diffScopeAll,
    openDifficulty,
    loadDifficultyPreview,
    applyDifficulty,
    calibrateDifficulty,
    // 建考试
    examOpen,
    examSaving,
    examForm,
    courses,
    loadCourses,
    openExamFromBank,
    createExamFromBank,
    // 体检
    healthOpen,
    healthLoading,
    health,
    loadHealth,
    toggleHealth,
    // 按册次挂课程
    bindBookTarget,
    bindCourseId,
    bindingBook,
    openBindBook,
    closeBindBook,
    confirmBindBook,
    // 菜单
    bankMenuItems,
    bankRowMenuItems,
    onBankRowMenu,
    onBankMenuSelect,
  };
}
