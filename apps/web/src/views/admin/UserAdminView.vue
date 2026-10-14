<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Toolbar from '@/components/Toolbar.vue';
import Icon from '@/components/Icon.vue';
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Role, User } from '@/api/types';

interface UsersResponse {
  users: User[];
}

interface AuditLog {
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

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学员',
};

const ROLE_BADGE: Record<Role, string> = {
  admin: 'mc-badge--primary',
  teacher: 'mc-badge--success',
  student: '',
};

const auth = useAuthStore();
const toast = useToastStore();

/* ---------------- 账号列表 ---------------- */
const users = ref<User[]>([]);
const usersLoading = ref(false);
const keyword = ref('');
const roleFilter = ref<'' | Role>('');

async function loadUsers(): Promise<void> {
  usersLoading.value = true;
  try {
    const res = await api.get<UsersResponse>('/users');
    users.value = res.users;
  } catch (e) {
    toast.error(errorMessage(e));
    users.value = [];
  } finally {
    usersLoading.value = false;
  }
}

const filteredUsers = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return users.value.filter((u) => {
    if (roleFilter.value !== '' && u.role !== roleFilter.value) return false;
    if (!kw) return true;
    return `${u.username} ${u.display_name}`.toLowerCase().includes(kw);
  });
});

/* ---------------- 新建账号 ---------------- */
const createOpen = ref(false);
const createSaving = ref(false);
const createForm = reactive<{ username: string; password: string; role: Role; displayName: string }>({
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
    await loadUsers();
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
const editForm = reactive<{ role: Role; displayName: string; password: string }>({
  role: 'student',
  displayName: '',
  password: '',
});

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
    await loadUsers();
    await loadLogs();
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
    await loadUsers();
    await loadLogs();
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/* ---------------- 审计日志 ---------------- */
const logs = ref<AuditLog[]>([]);
const logsLoading = ref(false);
const logLimit = ref(100);

async function loadLogs(): Promise<void> {
  logsLoading.value = true;
  try {
    const res = await api.get<AuditResponse>('/audit-logs', { limit: logLimit.value });
    logs.value = res.logs;
  } catch (e) {
    toast.error(errorMessage(e));
    logs.value = [];
  } finally {
    logsLoading.value = false;
  }
}

function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('zh-CN');
}

/** 审计日志 detail 里可能是任意 JSON 值，按原始类型安全转文本（对象走 JSON 序列化） */
function detailValueText(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return JSON.stringify(value) ?? '';
  }
}

function formatDetail(detail: string | null): string {
  if (!detail) return '—';
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed === null || typeof parsed !== 'object') return detailValueText(parsed);
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => `${key}=${detailValueText(value)}`)
      .join(', ');
  } catch {
    return detail;
  }
}

onMounted(() => {
  void loadUsers();
  void loadLogs();
});
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学员与账号"
      description="维护学员/教师/管理员账号，设置初始密码与角色；学员的学习记录随账号保留。"
      icon="users"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '学员与账号' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="usersLoading" @click="loadUsers">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="openCreate">
          <Icon name="plus" :size="15" />
          新建账号
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <template #left>
        <label class="mc-row toolbar__pick">
          <span class="mc-label">搜索</span>
          <input
            v-model.trim="keyword"
            class="mc-input toolbar__search"
            type="search"
            placeholder="搜索账号或姓名"
            aria-label="搜索账号"
          />
        </label>
        <label class="mc-row toolbar__pick">
          <span class="mc-label">角色</span>
          <select v-model="roleFilter" class="mc-select toolbar__select" aria-label="按角色筛选">
            <option value="">全部角色</option>
            <option value="student">学员</option>
            <option value="teacher">教师</option>
            <option value="admin">管理员</option>
          </select>
        </label>
      </template>
      <template #right>
        <span class="mc-muted toolbar__count">{{ filteredUsers.length }} / {{ users.length }} 个账号</span>
      </template>
    </Toolbar>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">账号列表</span>
        <span class="mc-muted">当前登录：{{ auth.displayName }}</span>
      </div>

      <div v-if="usersLoading && users.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="filteredUsers.length === 0"
        icon="users"
        title="没有匹配的账号"
        description="换个关键词，或点击「新建账号」为学员 / 教师开通登录账号。"
        action-text="新建账号"
        @action="openCreate"
      />

      <div
        v-else
        class="mc-table-wrap table-wrap"
        tabindex="0"
        role="region"
        aria-label="账号数据表（可用方向键横向滚动）"
      >
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>账号</th>
              <th>姓名</th>
              <th>角色</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td class="mc-mono">{{ user.username }}</td>
              <td>{{ user.display_name || '—' }}</td>
              <td>
                <span class="mc-badge" :class="ROLE_BADGE[user.role]">{{ ROLE_LABEL[user.role] }}</span>
              </td>
              <td class="mc-muted">{{ formatTime(user.created_at) }}</td>
              <td>
                <div class="row-actions">
                  <button class="mc-btn mc-btn--sm" type="button" @click="openEdit(user)">编辑</button>
                  <button
                    class="mc-btn mc-btn--sm mc-btn--danger"
                    type="button"
                    :disabled="auth.user?.id === user.id"
                    @click="removeUser(user)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">审计日志</span>
        <div class="mc-row mc-row--wrap">
          <label class="mc-row log__pick">
            <span class="mc-label">显示条数</span>
            <select v-model.number="logLimit" class="mc-select log__select" aria-label="日志条数" @change="loadLogs">
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
            </select>
          </label>
          <button class="mc-btn mc-btn--sm" type="button" :disabled="logsLoading" @click="loadLogs">
            {{ logsLoading ? '加载中…' : '刷新' }}
          </button>
        </div>
      </div>

      <div v-if="logsLoading && logs.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="logs.length === 0"
        icon="list"
        title="暂无审计日志"
        description="管理端的增删改操作（课程、课时、题库、考试、账号、设置等）都会记录在这里。"
      />

      <div
        v-else
        class="mc-table-wrap table-wrap"
        tabindex="0"
        role="region"
        aria-label="账号数据表（可用方向键横向滚动）"
      >
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td class="mc-muted log__time">{{ formatTime(log.created_at) }}</td>
              <td>{{ log.actor_name || '系统' }}</td>
              <td class="mc-mono">{{ log.action }}</td>
              <td class="mc-mono">{{ log.target_type }}{{ log.target_id ? `#${log.target_id}` : '' }}</td>
              <td class="log__detail">{{ formatDetail(log.detail) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <AppModal :open="createOpen" title="新建账号" width="520px" @close="createOpen = false">
      <div class="mc-col">
        <label class="mc-field">
          <span class="mc-label mc-label--required">账号</span>
          <input
            v-model="createForm.username"
            class="mc-input"
            type="text"
            maxlength="32"
            placeholder="2~32 个字符，登录用"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label mc-label--required">初始密码</span>
          <input
            v-model="createForm.password"
            class="mc-input"
            type="password"
            maxlength="128"
            placeholder="至少 6 位"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">角色</span>
          <select v-model="createForm.role" class="mc-select">
            <option value="student">学员</option>
            <option value="teacher">教师</option>
          </select>
          <span class="mc-hint">管理员账号只能由后端引导配置生成。</span>
        </label>

        <label class="mc-field">
          <span class="mc-label">姓名 / 昵称</span>
          <input
            v-model="createForm.displayName"
            class="mc-input"
            type="text"
            maxlength="64"
            placeholder="显示在成绩单与统计中"
          />
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="createOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="createSaving" @click="createUser">
          {{ createSaving ? '创建中…' : '创建' }}
        </button>
      </template>
    </AppModal>

    <AppModal :open="editOpen" title="编辑账号" width="520px" @close="editOpen = false">
      <div class="mc-col">
        <div class="mc-row mc-row--wrap">
          <span class="mc-label">账号</span>
          <span class="mc-mono">{{ editTarget?.username }}</span>
          <span class="mc-badge" :class="editTarget ? ROLE_BADGE[editTarget.role] : ''">
            {{ editTarget ? ROLE_LABEL[editTarget.role] : '' }}
          </span>
        </div>

        <label class="mc-field">
          <span class="mc-label">姓名 / 昵称</span>
          <input
            v-model="editForm.displayName"
            class="mc-input"
            type="text"
            maxlength="64"
            placeholder="显示在成绩单与统计中"
          />
        </label>

        <label class="mc-field">
          <span class="mc-label">角色</span>
          <select v-model="editForm.role" class="mc-select">
            <option value="student">学员</option>
            <option value="teacher">教师</option>
            <option value="admin">管理员</option>
          </select>
          <span class="mc-hint">仅当角色发生变化时才会提交该字段。</span>
        </label>

        <label class="mc-field">
          <span class="mc-label">重置密码</span>
          <input
            v-model="editForm.password"
            class="mc-input"
            type="password"
            maxlength="128"
            placeholder="留空表示不修改"
          />
        </label>
      </div>

      <template #footer>
        <button class="mc-btn" type="button" @click="editOpen = false">取消</button>
        <button class="mc-btn mc-btn--primary" type="button" :disabled="editSaving" @click="saveEdit">
          {{ editSaving ? '保存中…' : '保存' }}
        </button>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}

.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.toolbar__search {
  width: 240px;
}

.toolbar__select {
  width: 140px;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 42px;
}

.table-wrap {
  max-height: 46vh;
  overflow: auto;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.log__pick {
  gap: var(--mc-space-2);
}

.log__select {
  width: 100px;
}

.log__time {
  white-space: nowrap;
  font-size: var(--mc-text-xs);
}

.log__detail {
  max-width: 420px;
  word-break: break-all;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}
</style>
