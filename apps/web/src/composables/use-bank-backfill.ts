/**
 * 批量回填章节：dryRun 预览 → 确认执行 → 刷新目录与题库列表。
 *
 * 从 use-bank-sections 抽出：回填是低频批处理，打开弹窗、确认写库、刷新数据
 * 三个阶段状态独立，和「册次 → 章节」的浏览状态放在一起会让后者难读。
 */
import { ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { BankKindFilter } from '@/composables/use-bank-list';
import type { BackfillSectionsResult } from '@/views/admin/bankTypes';

export interface BankBackfillDeps {
  kindFilter: Ref<BankKindFilter>;
  reloadBanks: () => Promise<void>;
  reloadCourseCatalog: () => Promise<void>;
  reloadBookCatalog: () => Promise<void>;
}

export function useBankBackfill(deps: BankBackfillDeps) {
  const toast = useToastStore();
  const backfillOpen = ref(false);
  const backfillBusy = ref(false);
  const backfillPreview = ref<BackfillSectionsResult | null>(null);

  async function runBackfill(dryRun: boolean): Promise<void> {
    backfillBusy.value = true;
    try {
      const kind = deps.kindFilter.value;
      const res = await api.post<BackfillSectionsResult>('/banks/backfill-sections', {
        dryRun,
        ...(kind === '' ? {} : { kind }),
      });
      if (dryRun) {
        backfillPreview.value = res;
        if (res.filled === 0) {
          toast.info(res.skipped > 0 ? `没有可自动识别的章节，${res.skipped} 个题库仍留空` : '所有题库都已有章节');
        }
        return;
      }
      toast.success(`已为 ${res.filled} 个题库补上章节${res.skipped > 0 ? `，${res.skipped} 个仍留空` : ''}`);
      backfillOpen.value = false;
      backfillPreview.value = null;
      await Promise.all([deps.reloadBookCatalog(), deps.reloadBanks(), deps.reloadCourseCatalog()]);
    } catch (e) {
      toast.error(errorMessage(e));
      if (dryRun) backfillOpen.value = false;
    } finally {
      backfillBusy.value = false;
    }
  }

  function openBackfill(): void {
    backfillOpen.value = true;
    backfillPreview.value = null;
    void runBackfill(true);
  }

  function applyBackfill(): void {
    if (!backfillPreview.value || backfillPreview.value.filled === 0) return;
    void runBackfill(false);
  }

  function closeBackfill(): void {
    backfillOpen.value = false;
    backfillPreview.value = null;
  }

  return {
    backfillOpen,
    backfillBusy,
    backfillPreview,
    openBackfill,
    applyBackfill,
    closeBackfill,
  };
}
