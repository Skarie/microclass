/**
 * 题库级操作：建/改/删题库、重算难度、清理重复题、整卷建考试、题库体检，
 * 以及题库详情区的两个下拉菜单。
 *
 * 从 BankAdminView 抽出。选中的题库、题库/题目列表的刷新、导出与模板下载由参数注入。
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useBankForm } from '@/composables/use-bank-form';
import { useBankDifficulty } from '@/composables/use-bank-difficulty';
import { useBankQuickTools } from '@/composables/use-bank-quick-tools';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';
import type { MenuItem } from '@/components/DropdownMenu.vue';

interface OkResponse {
  ok: boolean;
}

export interface BankActionDeps {
  selectedBankId: Ref<number | null>;
  selectedBank: ComputedRef<Bank | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  loadQuestions: () => Promise<void>;
  /** 文件夹树 / 课程关联计数刷新（题库增删改、移动文件夹后） */
  refreshNav: () => Promise<void>;
  downloadTemplate: (kind: 'csv' | 'md') => Promise<void>;
  exportBank: (format: 'csv' | 'md' | 'docx', withAnswers?: boolean) => Promise<void>;
  /** 题库行菜单「关联课时」：打开整库粒度的关联弹窗（实现在 use-practice-links） */
  openBankPracticeLink: (bank: Bank) => void;
}

export function useBankActions(deps: BankActionDeps) {
  const toast = useToastStore();

  /* ---------------- 题库表单（名称 / 所属文件夹 / 关联课时） ---------------- */
  const form = useBankForm(deps);
  /* ---------------- 体检 / 难度 ---------------- */
  const difficulty = useBankDifficulty({ selectedBank: deps.selectedBank, loadBanks: deps.loadBanks });
  /* ---------------- 去重 / 整卷建考试 ---------------- */
  const quickTools = useBankQuickTools({
    selectedBank: deps.selectedBank,
    loadBanks: deps.loadBanks,
    closeHealth: () => {
      difficulty.healthOpen.value = false;
    },
  });

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
      await Promise.all([deps.loadBanks(false), deps.refreshNav()]);
    } catch (e) {
      toast.error(errorMessage(e));
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
      disabled: !deps.selectedBank.value || quickTools.dedupeBusy.value,
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
      { key: 'practice', label: '关联课时', icon: 'courses' },
      { key: 'delete', label: '删除题库', icon: 'trash', danger: true },
    ];
  }

  function onBankRowMenu(bank: Bank, key: string): void {
    if (key === 'rename') form.openEditBank(bank);
    else if (key === 'practice') deps.openBankPracticeLink(bank);
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
        quickTools.openExamFromBank();
        break;
      case 'dedupe':
        void quickTools.previewDedupe();
        break;
    }
  }

  return {
    // 题库表单（use-bank-form，保持原有对外形状）
    ...form,
    // 去重 / 整卷建考试、体检 / 难度重算
    ...quickTools,
    ...difficulty,
    removeBank,
    // 菜单
    bankMenuItems,
    bankRowMenuItems,
    onBankRowMenu,
    onBankMenuSelect,
  };
}
