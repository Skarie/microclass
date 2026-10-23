<script setup lang="ts">
import Tag from '@/components/Tag.vue';

/** 题量 / 及格线 / 倒计时状态条：样式随组件走（父页面不再保留这些规则）。 */
defineProps<{
  count: number;
  passScore?: number;
  clock: string;
  warn: boolean;
}>();
</script>

<template>
  <div class="take__status mc-card">
    <Tag tone="primary" icon="list">{{ count }} 题</Tag>
    <Tag v-if="passScore !== undefined" icon="target">及格线 {{ passScore }}%</Tag>
    <div class="mc-spacer" />
    <div class="clock" :class="{ 'clock--warn': warn }">
      <span class="mc-muted clock__label">剩余时间</span>
      <span class="clock__value mc-mono">{{ clock }}</span>
    </div>
  </div>
</template>

<style scoped>
.take__status {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding: var(--mc-space-2) var(--mc-space-4);
}

.clock {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 132px;
  padding: var(--mc-space-3) var(--mc-space-5);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-sunken);
}

.clock--warn {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.clock__label {
  font-size: var(--mc-text-xs);
}

.clock__value {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}
</style>
