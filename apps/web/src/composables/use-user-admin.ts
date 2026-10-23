import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import type { Role, User } from '@/api/types';

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

export interface CreateUserForm {
  username: string;
  password: string;
  role: Role;
  displayName: string;
}

export interface EditUserForm {
  role: Role;
  displayName: string;
  password: string;
}

interface UseUserAdminOptions {
  reloadUsers: () => Promise<void>;
  reloadLogs: () => Promise<void>;
}

/**
 * 账号写操作：新建 / 编辑（含重置密码与角色变更）/ 删除。
 * 读列表在 use-user-list、审计日志在 use-audit-log；写成功后由页面传入刷新函数。
 */
export function useUserAdmin(options: UseUserAdminOptions) {
  const auth = useAuthStore();
  const toast = useToastStore();

  /* ---------------- 新建账号 ---------------- */
  const createOpen = ref(false);
  const createSaving = ref(false);
  const createForm = reactive<CreateUserForm>({
    username: '',
    password: '',
    role: 'student',
    displayName: '',
  });

  function openCreate(): void {
    createForm.username = '';
    createForm.password = '';
    createForm.role = 'student';
    createForm.displayName = '';
    createOpen.value = true;
  }

  async function createUser(): Promise<void> {
    const username = createForm.username.trim();
    if (username.length < 2) {
      toast.warning('账号至少 2 个字符');
      return;
    }
    if (createForm.password.length < 6) {
      toast.warning('密码至少 6 位');
      return;
    }
    createSaving.value = true;
    try {
      const payload: { username: string; password: string; role: Role; displayName?: string } = {
        username,
        password: createForm.password,
        role: createForm.role,
      };
      const displayName = createForm.displayName.trim();
      if (displayName) payload.displayName = displayName;
      await api.post<OkIdResponse>('/users', payload);
      toast.success(`账号「${username}」已创建`);
      createOpen.value = false;
      await options.reloadUsers();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      createSaving.value = false;
    }
  }

  /* ---------------- 编辑账号 ---------------- */
  const editOpen = ref(false);
  const editSaving = ref(false);
  const editTarget = ref<User | null>(null);
  const editForm = reactive<EditUserForm>({ role: 'student', displayName: '', password: '' });

  function openEdit(user: User): void {
    editTarget.value = user;
    editForm.role = user.role;
    editForm.displayName = user.display_name;
    editForm.password = '';
    editOpen.value = true;
  }

  async function saveEdit(): Promise<void> {
    const user = editTarget.value;
    if (!user) return;
    const password = editForm.password.trim();
    if (password && password.length < 6) {
      toast.warning('新密码至少 6 位');
      return;
    }
    const payload: { password?: string; role?: Role; displayName?: string } = {
      displayName: editForm.displayName.trim(),
    };
    if (editForm.role !== user.role) payload.role = editForm.role;
    if (password) payload.password = password;
    if (!payload.displayName && !payload.role && !payload.password) {
      toast.info('没有需要保存的修改');
      return;
    }
    editSaving.value = true;
    try {
      await api.put<OkResponse>(`/users/${user.id}`, payload);
      toast.success(`账号「${user.username}」已更新`);
      editOpen.value = false;
      await options.reloadUsers();
      await options.reloadLogs();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      editSaving.value = false;
    }
  }

  async function removeUser(user: User): Promise<void> {
    const me = auth.user;
    if (me && me.id === user.id) {
      toast.error('不能删除当前登录的账号');
      return;
    }
    if (
      !window.confirm(
        `确定删除账号「${user.username}」吗？该账号的学习进度会被清除，且不可恢复。管理员账号无法在这里删除。`,
      )
    ) {
      return;
    }
    try {
      await api.del<OkResponse>(`/users/${user.id}`);
      toast.success(`账号「${user.username}」已删除`);
      await options.reloadUsers();
      await options.reloadLogs();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return reactive({
    createOpen,
    createSaving,
    createForm,
    openCreate,
    createUser,
    editOpen,
    editSaving,
    editTarget,
    editForm,
    openEdit,
    saveEdit,
    removeUser,
    currentUserName: computed(() => auth.displayName),
    currentUserId: computed(() => auth.user?.id ?? null),
  });
}
