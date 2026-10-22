<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 台账筛选状态由 useQuestionConflicts 持有，搜索框就地编辑（与课时列表一致） */
import { computed } from 'vue';
import { SYNC_REASON_LABEL, ageLabel } from './conflict-formatters';
import type { StatusFilter, useQuestionConflicts } from '@/composables/use-question-conflicts';

/**
 * 台账筛选条：状态页签（带各自数量）+ 台账新鲜度提示 + 本页内搜索。
 * 状态与关键字都由父级的 useQuestionConflicts 持有，这里只做展示与触发。
 */
const props = defineProps<{ list: ReturnType<typeof useQuestionConflicts> }>();

const tabs = computed<{ key: StatusFilter; label: string; n: number }[]>(() => [
  { key: 'pending', label: '待核对', n: props.list.data?.counts.pending ?? 0 },
  { key: 'resolved', label: '已核对', n: props.list.data?.counts.resolved ?? 0 },
  { key: 'ignored', label: '已忽略', n: props.list.data?.counts.ignored ?? 0 },
  { key: 'all', label: '全部', n: props.list.data?.counts.total ?? 0 },
]);

/** 台账年龄后缀：没有 ageMs（首次未扫描）时不显示 */
const ageSuffix = computed(() => {
  const sync = props.list.data?.sync;
  return sync && Number.isFinite(sync.ageMs) ? ` · 更新于 ${ageLabel(sync.ageMs)}` : '';
});
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__body tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ 'tab--active': list.statusFilter === tab.key }"
        type="button"
        @click="list.switchStatus(tab.key)"
      >
        {{ tab.label }}
        <span class="tab__n">{{ tab.n }}</span>
      </button>
      <span class="mc-muted tabs__hint">
        台账：{{ SYNC_REASON_LABEL[list.data?.sync.reason ?? ''] ?? '—' }}{{ ageSuffix }}
      </span>
      <input
        v-model="list.keyword"
        class="mc-input tabs__search"
        type="search"
        placeholder="本页内搜索题干/答案"
        aria-label="本页内搜索题干或答案"
      />
    </div>
  </section>
</template>

<style scoped>
.tabs {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill, 999px);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.tab--active {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
}

.tab__n {
  font-variant-numeric: tabular-nums;
}

.tabs__hint {
  margin-left: auto;
}

.tabs__search {
  max-width: 240px;
}
</style>
