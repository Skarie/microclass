/**
 * 题库新建 / 编辑表单（名称、册次、章节、关联课时）。
 *
 * 从 use-bank-actions 抽出：保存后要同时刷新题库列表、课程目录与按册次章节目录；
 * 章节留空时由服务端按关联课时的 group_name 自动继承，显式清空则重新继承。
 */
import { reactive, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

export interface BankFormState {
  name: string;
  book: string;
  section: string;
  lessonId: number | '';
}

export interface BankFormDeps {
  selectedBankId: Ref<number | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  loadCatalog: () => Promise<void>;
  loadBookCatalog: () => Promise<void>;
}

export function useBankForm(deps: BankFormDeps) {
  const toast = useToastStore();

  const bankFormOpen = ref(false);
  const bankSaving = ref(false);
  const bankEditingId = ref<number | null>(null);
  const bankForm = reactive<BankFormState>({ name: '', book: '', section: '', lessonId: '' });

  function openCreateBank(): void {
    bankEditingId.value = null;
    bankForm.name = '';
    bankForm.book = '';
    bankForm.section = '';
    bankForm.lessonId = '';
    bankFormOpen.value = true;
  }

  function openEditBank(bank: Bank): void {
    bankEditingId.value = bank.id;
    bankForm.name = bank.name;
    bankForm.book = bank.book ?? '';
    bankForm.section = bank.section ?? '';
    bankForm.lessonId = bank.lesson_id === null ? '' : bank.lesson_id;
    bankFormOpen.value = true;
  }

  async function saveBank(): Promise<void> {
    const name = bankForm.name.trim();
    if (!name) {
      toast.warning('请填写题库名称');
      return;
    }
    // 显式传空串：服务端会按 lessonId 重新继承章节，而不是保留旧值
    const payload = {
      name,
      book: bankForm.book.trim(),
      section: bankForm.section.trim(),
      lessonId: bankForm.lessonId === '' ? null : Number(bankForm.lessonId),
    };
    bankSaving.value = true;
    try {
      if (bankEditingId.value === null) {
        const res = await api.post<OkIdResponse>('/banks', payload);
        toast.success(`题库「${name}」已创建`);
        bankFormOpen.value = false;
        deps.selectedBankId.value = res.id;
      } else {
        await api.put<OkResponse>(`/banks/${bankEditingId.value}`, payload);
        toast.success(`题库「${name}」已保存`);
        bankFormOpen.value = false;
      }
      await Promise.all([deps.loadBanks(), deps.loadCatalog(), deps.loadBookCatalog()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bankSaving.value = false;
    }
  }

  return {
    bankFormOpen,
    bankSaving,
    bankEditingId,
    bankForm,
    openCreateBank,
    openEditBank,
    saveBank,
  };
}
