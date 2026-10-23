<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import { formatTime } from './user-admin-format';
import { ROLE_BADGE, ROLE_LABEL } from './user-roles';
import type { User } from '@/api/types';

defineProps<{
  users: User[];
  totalCount: number;
  loading: boolean;
  currentUserName: string;
  currentUserId: number | null;
}>();

const emit = defineEmits<{
  create: [];
  edit: [user: User];
  delete: [user: User];
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">账号列表</span>
      <span class="mc-muted">当前登录：{{ currentUserName }}</span>
    </div>

    <div v-if="loading && totalCount === 0" class="loading">
      <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="users.length === 0"
      icon="users"
      title="没有匹配的账号"
      description="换个关键词，或点击「新建账号」为学员 / 教师开通登录账号。"
      action-text="新建账号"
      @action="emit('create')"
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
          <tr v-for="user in users" :key="user.id">
            <td class="mc-mono">{{ user.username }}</td>
            <td>{{ user.display_name || '—' }}</td>
            <td>
              <span class="mc-badge" :class="ROLE_BADGE[user.role]">{{ ROLE_LABEL[user.role] }}</span>
            </td>
            <td class="mc-muted">{{ formatTime(user.created_at) }}</td>
            <td>
              <div class="row-actions">
                <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit', user)">编辑</button>
                <button
                  class="mc-btn mc-btn--sm mc-btn--danger"
                  type="button"
                  :disabled="currentUserId === user.id"
                  @click="emit('delete', user)"
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
</template>

<style scoped>
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
</style>
