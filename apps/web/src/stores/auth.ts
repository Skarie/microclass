import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { Role, User } from '@/api/types';

interface MetaResponse {
  siteName: string;
  user: User | null;
  allowRegister: boolean;
}

/** 会话与站点元信息：登录、注册、登出、角色判定 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const siteName = ref('微课堂');
  const allowRegister = ref(true);
  const loaded = ref(false);
  const loading = ref(false);

  const isLoggedIn = computed(() => user.value !== null);
  const role = computed<Role | null>(() => user.value?.role ?? null);
  const isAdmin = computed(() => role.value === 'admin');
  const isTeacher = computed(() => role.value === 'teacher' || role.value === 'admin');
  const isStudent = computed(() => role.value === 'student');
  const displayName = computed(() => user.value?.display_name || user.value?.username || '');

  /** 拉取站点元信息（应用启动时调用一次，用于恢复登录态） */
  async function fetchMeta(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    try {
      const meta = await api.get<MetaResponse>('/meta');
      siteName.value = meta.siteName;
      allowRegister.value = meta.allowRegister;
      user.value = meta.user;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function login(username: string, password: string): Promise<void> {
    // 换账号：先清 GET 缓存，避免读到上一个会话的响应
    api.clearCache();
    const res = await api.post<{ user: User }>('/auth/login', { username, password });
    user.value = res.user;
    loaded.value = true;
  }

  async function register(username: string, password: string, displayNameValue?: string): Promise<void> {
    api.clearCache();
    const res = await api.post<{ user: User }>('/auth/register', {
      username,
      password,
      ...(displayNameValue ? { displayName: displayNameValue } : {}),
    });
    user.value = res.user;
    loaded.value = true;
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout');
    } finally {
      // 退出后清缓存：下一次登录不会拿到上一个账号的数据
      api.clearCache();
      user.value = null;
    }
  }

  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.put('/me/password', { oldPassword, newPassword });
  }

  function clear(): void {
    user.value = null;
  }

  return {
    user,
    siteName,
    allowRegister,
    loaded,
    loading,
    isLoggedIn,
    role,
    isAdmin,
    isTeacher,
    isStudent,
    displayName,
    fetchMeta,
    login,
    register,
    logout,
    changePassword,
    clear,
  };
});
