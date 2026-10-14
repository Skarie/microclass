import { ref, type Ref } from 'vue';
import { ApiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';

export interface AsyncState<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  run: (silent?: boolean) => Promise<T | null>;
}

/**
 * 统一异步加载：loading / error / data 三态 + 失败轻提示。
 * 视图里只需 `const { data, loading, run } = useAsync(() => api.get(...))`。
 */
export function useAsync<T>(loader: () => Promise<T>, options?: { immediate?: boolean }): AsyncState<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  const toast = useToastStore();

  async function run(silent = false): Promise<T | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await loader();
      data.value = result;
      return result;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : '请求失败';
      error.value = message;
      if (!silent) toast.error(message);
      return null;
    } finally {
      loading.value = false;
    }
  }

  if (options?.immediate !== false) void run();

  return { data, loading, error, run };
}

/** 把任意异常转成给用户看的文案 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '操作失败，请稍后重试';
}
