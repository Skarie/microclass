<script setup lang="ts">
import { computed } from 'vue';
import { useRovingTabs } from '@/composables/use-roving-tabs';
import type { Tab } from './course-admin-types';

/**
 * 课程管理四个选项卡：只负责切换与计数展示，数据由页面传入。
 * 键盘 ←/→ 可切换（与学情分析页签同一套行为）。
 */
const props = defineProps<{
  tab: Tab;
  courseCount: number;
  lessonCount: number;
  orphanCount: number;
  rootCount: number;
}>();

const emit = defineEmits<{ (e: 'update:tab', tab: Tab): void }>();

const tabs = computed<{ key: Tab; label: string; count: number }[]>(() => [
  { key: 'courses', label: '课程', count: props.courseCount },
  { key: 'lessons', label: '全部课时', count: props.lessonCount },
  { key: 'orphans', label: '未归类课时', count: props.orphanCount },
  { key: 'roots', label: '媒体目录', count: props.rootCount },
]);

const { setItem, onKeydown } = useRovingTabs(() => tabs.value.length);

function pick(index: number): void {
  const next = tabs.value[index];
  if (next) emit('update:tab', next.key);
}
</script>

<template>
  <div class="mc-row mc-row--wrap tabs" role="tablist" aria-label="课程管理分区">
    <button
      v-for="(t, i) in tabs"
      :key="t.key"
      :ref="(el) => setItem(el, i)"
      class="tab"
      :class="{ 'is-active': tab === t.key }"
      type="button"
      role="tab"
      :aria-selected="tab === t.key"
      :tabindex="tab === t.key ? 0 : -1"
      @click="emit('update:tab', t.key)"
      @keydown="onKeydown($event, i, pick)"
    >
      {{ t.label }}
      <span v-if="t.count > 0 || t.key === 'courses'" class="tab__count">{{ t.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  gap: var(--mc-space-2);
  border-bottom: 1px solid var(--mc-border);
  padding-bottom: var(--mc-space-2);
}

.tab {
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  transition: var(--mc-transition-all);
}

.tab:hover:not(.is-active) {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.tab:active {
  transform: scale(var(--mc-press-scale));
}

.tab.is-active {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.tab:focus-visible {
  outline: var(--mc-focus-ring-width) solid var(--mc-primary);
  outline-offset: var(--mc-focus-ring-offset);
}

.tab__count {
  opacity: 0.8;
  font-size: var(--mc-text-xs);
}

@media (max-width: 1023px) {
  .tab {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
