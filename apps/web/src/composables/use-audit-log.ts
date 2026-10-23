import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';

export interface AuditLog {
  id: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: string | null;
  created_at: number;
}

interface AuditResponse {
  logs: AuditLog[];
}

/** 审计日志：/audit-logs 数据、加载态与显示条数。 */
export function useAuditLog() {
  const toast = useToastStore();
  const logs = ref<AuditLog[]>([]);
  const loading = ref(false);
  const limit = ref(100);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<AuditResponse>('/audit-logs', { limit: limit.value });
      logs.value = res.logs;
    } catch (e) {
      toast.error(errorMessage(e));
      logs.value = [];
    } finally {
      loading.value = false;
    }
  }

  return reactive({ logs, loading, limit, load });
}
