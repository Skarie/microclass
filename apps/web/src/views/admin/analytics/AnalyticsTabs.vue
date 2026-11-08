<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { useRovingTabs } from '@/composables/use-roving-tabs';
import type { IconName } from '@/components/icons';
import type { AnalyticsTab } from './analytics-types';

/** 四个页签的分段控件：单行、窄屏横向滚动、←/→ 可切换（键盘与鼠标同权）。 */
defineProps<{ tab: AnalyticsTab }>();
const emit = defineEmits<{ select: [tab: AnalyticsTab] }>();

const TABS: { key: AnalyticsTab; label: string; icon: IconName }[] = [
  { key: 'points', label: '知识点掌握度', icon: 'chartBar' },
  { key: 'students', label: '学员学情', icon: 'users' },
  { key: 'wrong', label: '高频错题', icon: 'flame' },
  { key: 'trend', label: '作答趋势', icon: 'trendingUp' },
];

const { setItem, onKeydown } = useRovingTabs(() => TABS.length);

function pick(index: number): void {
  const next = TABS[index];
  if (next) emit('select', next.key);
}
</script>

<template>
  <div class="ana__tabs" role="tablist">
    <button
      v-for="(t, i) in TABS"
      :key="t.key"
      :ref="(el) => setItem(el, i)"
      class="ana__tab"
      :class="{ 'is-active': tab === t.key }"
      type="button"
      role="tab"
      :aria-selected="tab === t.key"
      :tabindex="tab === t.key ? 0 : -1"
      @click="emit('select', t.key)"
      @keydown="onKeydown($event, i, pick)"
    >
      <Icon :name="t.icon" :size="16" />
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
  background: var(--mc-bg-sunken);
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
  transition: var(--mc-transition-all);
}

/* 未选中项：hover 只浮浅底，不抢选中项的实心白块 */
.ana__tab:not(.is-active):hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.ana__tab:active {
  transform: scale(var(--mc-press-scale));
}

.ana__tab.is-active {
  color: var(--mc-primary-fg);
  background: var(--mc-bg-elevated);
  border-color: var(--mc-border);
  box-shadow: var(--mc-shadow-xs);
  font-weight: var(--mc-font-medium);
}

.ana__tab:focus-visible {
  outline: var(--mc-focus-ring-width) solid var(--mc-primary);
  outline-offset: var(--mc-focus-ring-offset);
}

@media (max-width: 1023px) {
  .ana__tab {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
