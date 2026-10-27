/**
 * 题库的「轻量工具」：清理重复题、用整卷试卷一键建考试。
 *
 * 从 use-bank-actions 抽出：两者都是两层弹窗里的二次操作，
 * 打开前要先关掉体检弹窗（由 closeHealth 注入），避免遮罩拦截。
 */
import { reactive, ref, type ComputedRef } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';
import type { DedupeResult } from '@/views/admin/bankTypes';

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

export interface BankQuickToolsDeps {
  selectedBank: ComputedRef<Bank | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  /** 打开下一层弹窗前收起体检弹窗 */
  closeHealth: () => void;
}

export function useBankQuickTools(deps: BankQuickToolsDeps) {
  const toast = useToastStore();

  /* ---------------- 题库内去重（标准化） ---------------- */
  const dedupeBusy = ref(false);
  const dedupeResult = ref<DedupeResult | null>(null);

  async function previewDedupe(): Promise<void> {
    // 两层弹窗叠着时，后开弹窗的按钮会被前一层遮罩拦截，先关掉体检弹窗
    deps.closeHealth();
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
    deps.closeHealth();
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

  return {
    dedupeBusy,
    dedupeResult,
    previewDedupe,
    applyDedupe,
    examOpen,
    examSaving,
    examForm,
    courses,
    loadCourses,
    openExamFromBank,
    createExamFromBank,
  };
}
