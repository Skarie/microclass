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
            <td class="mc-mono col-user">{{ user.username }}</td>
            <td class="col-name">{{ user.display_name || '—' }}</td>
            <td class="col-role">
              <span class="mc-badge" :class="ROLE_BADGE[user.role]">{{ ROLE_LABEL[user.role] }}</span>
            </td>
            <td class="mc-muted col-time">{{ formatTime(user.created_at) }}</td>
            <td class="col-ops">
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

/* 移动端（≤900px）：账号表 → 卡片行，不改数据与事件 */
@media (max-width: 900px) {
  .table-wrap {
    max-height: none;
    overflow: visible;
  }

  .mc-table,
  .mc-table tbody {
    display: block;
  }

  .mc-table thead {
    display: none;
  }

  .mc-table tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'user role'
      'name name'
      'time time'
      'ops ops';
    gap: var(--mc-space-2) var(--mc-space-3);
    margin-bottom: var(--mc-space-2);
    padding: var(--mc-space-3);
    border: 1px solid var(--mc-border);
    border-radius: var(--mc-radius-md);
    background: var(--mc-bg-elevated);
  }

  .mc-table tbody tr:nth-child(even) td {
    background: transparent;
  }

  .mc-table tbody td {
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .col-user {
    grid-area: user;
    font-size: var(--mc-text-sm);
    font-weight: var(--mc-font-semibold);
    color: var(--mc-text);
  }

  .col-name {
    grid-area: name;
    font-size: var(--mc-text-sm);
    color: var(--mc-text-secondary);
  }

  .col-role {
    grid-area: role;
    justify-self: end;
  }

  .col-time {
    grid-area: time;
    font-size: var(--mc-text-xs);
  }

  .col-ops {
    grid-area: ops;
  }

  .row-actions {
    justify-content: flex-end;
  }
}
</style>
