<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';
import type { AnalyticsTab } from './analytics-types';

/** 四个页签的分段控件（样式为刚修过的回归点：单行、窄屏横向滚动、不换行）。 */
defineProps<{ tab: AnalyticsTab }>();
const emit = defineEmits<{ select: [tab: AnalyticsTab] }>();

const TABS: { key: AnalyticsTab; label: string; icon: IconName }[] = [
  { key: 'points', label: '知识点掌握度', icon: 'chartBar' },
  { key: 'students', label: '学员学情', icon: 'users' },
  { key: 'wrong', label: '高频错题', icon: 'flame' },
  { key: 'trend', label: '作答趋势', icon: 'trendingUp' },
];
</script>

<template>
  <div class="ana__tabs" role="tablist">
    <button
      v-for="t in TABS"
      :key="t.key"
      class="ana__tab"
      :class="{ 'is-active': tab === t.key }"
      type="button"
      role="tab"
      :aria-selected="tab === t.key"
      @click="emit('select', t.key)"
    >
      <Icon :name="t.icon" :size="15" />
      {{ t.label }}
    </button>
  </div>
</template>

<style scoped>
.ana__tabs {
  /* 分段控件形态：单行、不换行，窗口再窄也只会横向滚动，不会把标签挤出去 */
  display: flex;
  flex-wrap: nowrap;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-subtle);
  overflow-x: auto;
  scrollbar-width: none;
}

.ana__tabs::-webkit-scrollbar {
  display: none;
}

.ana__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-1);
  flex: none;
  min-height: 34px;
  white-space: nowrap;
  padding: var(--mc-space-1) var(--mc-space-3);
  border: 1px solid transparent;
  border-radius: var(--mc-radius-sm);
  background: none;
  cursor: pointer;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
}

.ana__tab.is-active {
  color: var(--mc-primary-fg);
  background: var(--mc-bg-elevated);
  border-color: var(--mc-border);
  box-shadow: var(--mc-shadow-sm);
  font-weight: var(--mc-font-medium);
}
</style>
