<script setup lang="ts">
import type { Tab } from './course-admin-types';

/**
 * 课程管理四个选项卡。只负责切换与计数展示，数据由页面传入。
 * 计数文案与拆分前一致（课程/全部课时/未归类课时/媒体目录）。
 */
defineProps<{
  tab: Tab;
  courseCount: number;
  lessonCount: number;
  orphanCount: number;
  rootCount: number;
}>();

const emit = defineEmits<{ (e: 'update:tab', tab: Tab): void }>();
</script>

<template>
  <div class="mc-row mc-row--wrap tabs" role="tablist" aria-label="课程管理分区">
    <button
      class="tab"
      :class="{ 'is-active': tab === 'courses' }"
      type="button"
      role="tab"
      :aria-selected="tab === 'courses'"
      @click="emit('update:tab', 'courses')"
    >
      课程 <span class="tab__count">{{ courseCount }}</span>
    </button>
    <button
      class="tab"
      :class="{ 'is-active': tab === 'lessons' }"
      type="button"
      role="tab"
      :aria-selected="tab === 'lessons'"
      @click="emit('update:tab', 'lessons')"
    >
      全部课时 <span v-if="lessonCount > 0" class="tab__count">{{ lessonCount }}</span>
    </button>
    <button
      class="tab"
      :class="{ 'is-active': tab === 'orphans' }"
      type="button"
      role="tab"
      :aria-selected="tab === 'orphans'"
      @click="emit('update:tab', 'orphans')"
    >
      未归类课时 <span class="tab__count">{{ orphanCount }}</span>
    </button>
    <button
      class="tab"
      :class="{ 'is-active': tab === 'roots' }"
      type="button"
      role="tab"
      :aria-selected="tab === 'roots'"
      @click="emit('update:tab', 'roots')"
    >
      媒体目录 <span class="tab__count">{{ rootCount }}</span>
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
  font-size: var(--mc-text-sm, 13px);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
}

.tab:hover {
  background: var(--mc-bg-sunken);
}

.tab.is-active {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.tab__count {
  opacity: 0.8;
  font-size: var(--mc-text-xs);
}
</style>
