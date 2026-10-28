/**
 * 题库新建 / 编辑表单（名称、所属文件夹、关联课时）。
 *
 * 保存后要同时刷新题库列表、左栏文件夹/课程计数（refreshNav）；
 * 文件夹传 null 表示移到「未分类」。
 */
import { reactive, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { bankFolderId } from '@/views/admin/bankTypes';
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
  folderId: number | '';
  lessonId: number | '';
}

export interface BankFormDeps {
  selectedBankId: Ref<number | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
  /** 文件夹 / 课程关联计数变了，左栏要跟着刷 */
  refreshNav: () => Promise<void>;
}

export function useBankForm(deps: BankFormDeps) {
  const toast = useToastStore();

  const bankFormOpen = ref(false);
  const bankSaving = ref(false);
  const bankEditingId = ref<number | null>(null);
  const bankForm = reactive<BankFormState>({ name: '', folderId: '', lessonId: '' });

  /** 新建时默认选中当前浏览的文件夹（未分类 / 全部题库则留空） */
  function openCreateBank(folderId: number | null = null): void {
    bankEditingId.value = null;
    bankForm.name = '';
    bankForm.folderId = folderId ?? '';
    bankForm.lessonId = '';
    bankFormOpen.value = true;
  }

  function openEditBank(bank: Bank): void {
    bankEditingId.value = bank.id;
    bankForm.name = bank.name;
    bankForm.folderId = bankFolderId(bank) ?? '';
    bankForm.lessonId = bank.lesson_id === null ? '' : bank.lesson_id;
    bankFormOpen.value = true;
  }

  async function saveBank(): Promise<void> {
    const name = bankForm.name.trim();
    if (!name) {
      toast.warning('请填写题库名称');
      return;
    }
    const payload = {
      name,
      folderId: bankForm.folderId === '' ? null : Number(bankForm.folderId),
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
      await Promise.all([deps.loadBanks(), deps.refreshNav()]);
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
