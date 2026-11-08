<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { useRovingTabs } from '@/composables/use-roving-tabs';
import type { IconName } from '@/components/icons';
import type { BankNavView } from './bankTypes';

/**
 * 左侧题库目录的视图切换（分段控件）。
 * 视觉与学情分析页签一致：单行、不换行、窄屏横向滚动，选中项为白底描边；←/→ 可切换。
 */
defineProps<{ modelValue: BankNavView }>();
const emit = defineEmits<{ 'update:modelValue': [view: BankNavView] }>();

const VIEWS: { key: BankNavView; label: string; icon: IconName }[] = [
  { key: 'folder', label: '题库', icon: 'folder' },
  { key: 'course', label: '课程关联', icon: 'courses' },
];

const { setItem, onKeydown } = useRovingTabs(() => VIEWS.length);

function pick(index: number): void {
  const next = VIEWS[index];
  if (next) emit('update:modelValue', next.key);
}
</script>

<template>
  <div class="nav-view" role="tablist" aria-label="题库目录视图">
    <button
      v-for="(view, i) in VIEWS"
      :key="view.key"
      :ref="(el) => setItem(el, i)"
      class="nav-view__tab"
      :class="{ 'is-active': modelValue === view.key }"
      type="button"
      role="tab"
      :aria-selected="modelValue === view.key"
      :tabindex="modelValue === view.key ? 0 : -1"
      @click="emit('update:modelValue', view.key)"
      @keydown="onKeydown($event, i, pick)"
    >
      <Icon :name="view.icon" :size="14" />
      {{ view.label }}
    </button>
  </div>
</template>

<style scoped>
.nav-view {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--mc-space-1);
  width: 100%;
  padding: var(--mc-space-1);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  overflow-x: auto;
  scrollbar-width: none;
}

.nav-view::-webkit-scrollbar {
  display: none;
}

.nav-view__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-1);
  flex: 1;
  min-height: 32px;
  white-space: nowrap;
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid transparent;
  border-radius: var(--mc-radius-sm);
  background: none;
  cursor: pointer;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
  transition: var(--mc-transition-all);
}

.nav-view__tab:not(.is-active):hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.nav-view__tab:active {
  transform: scale(var(--mc-press-scale));
}

.nav-view__tab.is-active {
  color: var(--mc-primary-fg);
  background: var(--mc-bg-elevated);
  border-color: var(--mc-border);
  box-shadow: var(--mc-shadow-xs);
  font-weight: var(--mc-font-medium);
}

.nav-view__tab:focus-visible {
  outline: var(--mc-focus-ring-width) solid var(--mc-primary);
  outline-offset: var(--mc-focus-ring-offset);
}

@media (max-width: 1023px) {
  .nav-view__tab {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
