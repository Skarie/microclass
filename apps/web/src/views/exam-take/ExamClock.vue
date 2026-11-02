<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/** 考试倒计时：题头右侧小字，最后 1 分钟整体转红（不再用大底色徽标） */
defineProps<{ clock: string; warn: boolean; limited: boolean }>();
</script>

<template>
  <span class="clock" :class="{ 'clock--warn': warn }" role="timer" aria-label="考试剩余时间">
    <Icon name="clock" :size="14" />
    <template v-if="limited">
      <span class="clock__label">剩余</span>
      <span class="clock__value">{{ clock }}</span>
    </template>
    <span v-else class="clock__label">不限时</span>
  </span>
</template>

<style scoped>
.clock {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.clock--warn {
  color: var(--mc-danger-fg);
  font-weight: var(--mc-font-semibold);
}

.clock__value {
  color: inherit;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-bold);
  font-variant-numeric: tabular-nums;
}
</style>
