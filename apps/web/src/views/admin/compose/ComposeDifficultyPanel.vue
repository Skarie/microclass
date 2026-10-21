<script setup lang="ts">
import { LEVEL_LABEL } from '@/composables/use-exam-compose';
import type { DifficultyItem } from '@/composables/use-exam-paper';

/** 难度分布（实际 / 目标）：偏差超过 10 个百分点标红。 */
defineProps<{ items: DifficultyItem[] }>();
</script>

<template>
  <div class="stp__diff">
    <span class="mc-label">难度分布（实际 / 目标）</span>
    <div v-for="c in items" :key="c.level" class="stp__diffrow">
      <span>{{ LEVEL_LABEL[c.level] }}</span>
      <div class="stp__diffbar">
        <div class="stp__difffill" :style="{ width: `${Math.min(100, c.actual)}%` }" />
      </div>
      <span :class="{ 'is-off': c.off > 10 }">{{ c.actual }}% / {{ c.target }}%</span>
    </div>
  </div>
</template>

<style scoped>
.stp__diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__diffrow {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.stp__diffbar {
  height: 10px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.stp__difffill {
  height: 100%;
  background: var(--mc-primary);
}

.stp__diffrow .is-off {
  color: var(--mc-danger-fg);
  font-weight: var(--mc-font-medium);
}
</style>
