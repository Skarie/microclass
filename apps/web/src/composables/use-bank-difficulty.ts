/**
 * 题库体检与难度重算：预览、写回、用真实作答校准。
 *
 * 从 use-bank-actions 抽出：体检数据同时供顶部 KPI 和体检弹窗使用，
 * 难度面板与体检弹窗共用「先关体检再开下一层」的规则。
 *
 * 体检接口自 2.3.1 起是异步契约（迁移 0031）：冷缓存先回 202，后台 worker 算完再给结果；
 * 轮询与阶段状态收在 `use-bank-health-poll`，这里只把状态转成组件用的字段。
 */
import { computed, ref, type ComputedRef } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useBankHealthPoll } from '@/composables/use-bank-health-poll';
import { useToastStore } from '@/stores/toast';
import type { Bank } from '@/api/types';
import type { DifficultyPreview } from '@/views/admin/bankTypes';

interface DifficultyApplyResult {
  scored: number;
  updated: number;
  skippedManual: number;
  skippedCalibrated: number;
  cuts: { easyMax: number; mediumMax: number };
  buckets: { difficulty: string; questions: number }[];
}

export interface BankDifficultyDeps {
  selectedBank: ComputedRef<Bank | null>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
}

export function useBankDifficulty(deps: BankDifficultyDeps) {
  const toast = useToastStore();

  /* ---------------- 题库体检（标准化与质量） ---------------- */
  const healthOpen = ref(false);
  const healthPoll = useBankHealthPoll({ limit: 10 });
  const health = healthPoll.health;
  const healthLoading = computed(() => healthPoll.loading.value);
  const healthComputing = healthPoll.computing;
  const healthError = healthPoll.error;

  async function loadHealth(silent = false): Promise<void> {
    await healthPoll.load();
    if (!silent && healthPoll.error.value) toast.error(healthPoll.error.value);
  }

  function toggleHealth(): void {
    healthOpen.value = !healthOpen.value;
    if (healthOpen.value) void loadHealth();
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

  return {
    healthOpen,
    healthLoading,
    health,
    /** 体检正在后台计算（202）：界面显示「体检计算中（后台进行，可继续操作）」 */
    healthComputing,
    healthError,
    /** 失败/手动重试（refresh=1 强制重算） */
    retryHealth: healthPoll.retry,
    loadHealth,
    toggleHealth,
    diffOpen,
    diffBusy,
    diffPreview,
    diffScopeAll,
    openDifficulty,
    loadDifficultyPreview,
    applyDifficulty,
    calibrateDifficulty,
  };
}
