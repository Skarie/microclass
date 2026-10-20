/**
 * 题库导入与导出：模板下载、CSV / Markdown / Word 导出、导入文件选择与结果。
 *
 * 从 BankAdminView 抽出。题目列表与题库列表的刷新、分页页码由参数注入，
 * 不依赖页面里的其它状态。
 */
import { ref, type ComputedRef, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';

interface ImportResponse {
  ok: boolean;
  inserted: number;
  errors: string[];
  /** 能导入但需要留意的提示（如被忽略的图片链接） */
  warnings?: string[];
}

export interface ImportResult {
  inserted: number;
  errors: string[];
  warnings: string[];
}

/** 题库导入/导出要用的外部状态（由目录、题目列表组合式函数提供） */
export interface BankImportDeps {
  selectedBankId: Ref<number | null>;
  selectedBank: ComputedRef<Bank | null>;
  loadQuestions: () => Promise<void>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  /** 题目列表当前页（导入后回到第一页） */
  page: Ref<number>;
  /** 隐藏的文件输入框（模板里的 ref="fileInput"） */
  fileInput: Ref<HTMLInputElement | null>;
}

export function useBankImport(deps: BankImportDeps) {
  const toast = useToastStore();

  const importing = ref(false);
  const importResult = ref<ImportResult | null>(null);

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
    const bank = deps.selectedBank.value;
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
    if (deps.selectedBankId.value === null) {
      toast.warning('请先选择题库');
      return;
    }
    deps.fileInput.value?.click();
  }

  async function onImportFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const bankId = deps.selectedBankId.value;
    if (!file || bankId === null) return;
    const fd = new FormData();
    fd.append('file', file);
    importing.value = true;
    try {
      const res = await api.upload<ImportResponse>(`/banks/${bankId}/import`, fd);
      importResult.value = { inserted: res.inserted, errors: res.errors, warnings: res.warnings ?? [] };
      toast.success(`成功导入 ${res.inserted} 道题目`, res.errors.length > 0 ? `有 ${res.errors.length} 题未导入` : '');
      deps.page.value = 1;
      await deps.loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      importing.value = false;
    }
  }

  return {
    importing,
    importResult,
    downloadTemplate,
    exportBank,
    pickImportFile,
    onImportFilePicked,
  };
}
