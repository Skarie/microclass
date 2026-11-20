/**
 * 全库体检轮询（迁移 0031）：接口从「同步 200」改成「缓存命中 200 / 冷缓存 202」。
 *
 * 契约：
 *   - 200 → 直接是体检结果（`status:'ready'`）；
 *   - 202 → `{status:'computing'}`：后台 worker 正在算（可能几分钟），每 3s 查一次
 *     `/banks/health/status`，ready 后自动再拉结果并刷新界面；
 *   - 失败 → 暴露 `error` 给界面显示原因 + 重试，**不把 202 当错误**。
 *
 * 组件卸载（scope dispose）时清掉定时器，避免离开页面还在轮询。
 */
import { computed, onScopeDispose, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import {
  isHealthComputing,
  type BankHealth,
  type BankHealthPhase,
  type BankHealthStatusResponse,
} from '@/views/admin/bankTypes';

export interface BankHealthPollOptions {
  /** 重复题明细条数（体检接口的 limit） */
  limit?: number;
  /** 轮询间隔，默认 3s（与后端 202 里的 retryAfterMs 一致） */
  pollMs?: number;
}

export function useBankHealthPoll(options: BankHealthPollOptions = {}) {
  const limit = options.limit ?? 10;
  const pollMs = options.pollMs ?? 3000;

  const health = ref<BankHealth | null>(null);
  const phase = ref<BankHealthPhase>('idle');
  const error = ref('');

  const loading = computed(() => phase.value === 'loading');
  const computing = computed(() => phase.value === 'computing');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function stop(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(callback: () => void): void {
    stop();
    if (disposed) return;
    timer = setTimeout(callback, pollMs);
  }

  async function load(refresh = false): Promise<void> {
    stop();
    phase.value = 'loading';
    error.value = '';
    try {
      const body = await api.get<BankHealth | { status: 'computing' }>('/banks/health', {
        limit,
        ...(refresh ? { refresh: 1 } : {}),
      });
      if (isHealthComputing(body)) {
        phase.value = 'computing';
        schedule(() => void poll());
        return;
      }
      health.value = body as BankHealth;
      phase.value = 'ready';
    } catch (e) {
      phase.value = 'error';
      error.value = errorMessage(e);
    }
  }

  async function poll(): Promise<void> {
    if (disposed) return;
    try {
      const status = await api.get<BankHealthStatusResponse>('/banks/health/status');
      if (status.status === 'ready') {
        await load();
        return;
      }
      if (status.status === 'stale') {
        phase.value = 'error';
        error.value = status.error ? `体检计算失败：${status.error}` : '体检计算已停止，请重试';
        return;
      }
      phase.value = 'computing';
      schedule(() => void poll());
    } catch (e) {
      phase.value = 'error';
      error.value = errorMessage(e);
    }
  }

  /** 失败后的重试：同一次刷新语义（refresh=true 会强制重算） */
  async function retry(): Promise<void> {
    await load(true);
  }

  onScopeDispose(() => {
    disposed = true;
    stop();
  });

  return { health, phase, error, loading, computing, load, retry, stop };
}

export type BankHealthPoll = ReturnType<typeof useBankHealthPoll>;
