<script setup lang="ts">
import type { StatItem } from './stats-types';

/**
 * KPI 卡片行：课时统计 7 项 / 课程统计 4 项共用。
 * 数值与文案由 stats-types 的派生函数给出，百分号已拼在 value 里。
 */
defineProps<{ items: StatItem[] }>();
</script>

<template>
  <div class="mc-grid mc-grid--stats">
    <div v-for="item in items" :key="item.label" class="stat mc-card">
      <span class="stat__value">{{ item.value }}</span>
      <span class="stat__label">{{ item.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mc-space-4);
}

.stat__value {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-bold);
}

.stat__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
