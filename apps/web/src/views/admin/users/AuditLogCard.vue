<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import { formatDetail, formatTime } from './user-admin-format';
import type { AuditLog } from '@/composables/use-audit-log';

defineProps<{
  logs: AuditLog[];
  loading: boolean;
  limit: number;
}>();

const emit = defineEmits<{
  'limit-change': [limit: number];
  refresh: [];
}>();

function onLimitChange(e: Event): void {
  emit('limit-change', Number((e.target as HTMLSelectElement).value));
}
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">审计日志</span>
      <div class="mc-row mc-row--wrap">
        <label class="mc-row log__pick">
          <span class="mc-label">显示条数</span>
          <select :value="limit" class="mc-select log__select" aria-label="日志条数" @change="onLimitChange">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
          </select>
        </label>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="loading && logs.length === 0" class="loading">
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
