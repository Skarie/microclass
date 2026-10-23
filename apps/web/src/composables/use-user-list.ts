import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Role, User } from '@/api/types';

interface UsersResponse {
  users: User[];
}

/**
 * 账号列表：/users 数据、关键词 / 角色筛选与加载态。
 * 只负责读；新建 / 编辑 / 删除在 use-user-admin，审计日志在 use-audit-log。
 */
export function useUserList() {
  const toast = useToastStore();
  const users = ref<User[]>([]);
  const loading = ref(false);
  const keyword = ref('');
  const roleFilter = ref<'' | Role>('');

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<UsersResponse>('/users');
      users.value = res.users;
    } catch (e) {
      toast.error(errorMessage(e));
      users.value = [];
    } finally {
      loading.value = false;
    }
  }

  const filtered = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    return users.value.filter((u) => {
      if (roleFilter.value !== '' && u.role !== roleFilter.value) return false;
      if (!kw) return true;
      return `${u.username} ${u.display_name}`.toLowerCase().includes(kw);
    });
  });

  return reactive({ users, loading, keyword, roleFilter, filtered, load });
}
