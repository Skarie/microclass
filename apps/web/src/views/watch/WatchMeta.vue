<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { Lesson } from '@/api/types';

/** 播放提示 + 观看进度 + 课时目录（上一节 / 下一节）。 */
defineProps<{
  quizUnlocked: boolean;
  watchedPercent: number;
  coveredPercent: number | null;
  currentTime: number;
  duration: number;
  savedAt: string;
  prevLesson: Lesson | undefined;
  nextLesson: Lesson | undefined;
  formatTime: (seconds: number) => string;
}>();
</script>

<template>
  <div v-if="!quizUnlocked" class="notice mc-card">
    <Icon name="shield" :size="16" class="watch__lock" />
    <span> 本地视频需看完 <strong>80%</strong> 才能解锁课后练习，当前已观看 {{ watchedPercent }}%。 </span>
  </div>

  <div class="watch__meta mc-card">
    <div class="mc-row mc-row--between">
      <span class="mc-muted">
        观看进度 {{ watchedPercent }}%
        <template v-if="coveredPercent !== null"> · 实际看过 {{ coveredPercent }}%</template>
        <template v-if="duration > 0"> · {{ formatTime(currentTime) }} / {{ formatTime(duration) }}</template>
        <template v-if="savedAt"> · 已自动保存（{{ savedAt }}）</template>
      </span>
      <div class="mc-row">
        <RouterLink v-if="prevLesson" class="mc-btn mc-btn--sm" :to="{ name: 'watch', params: { id: prevLesson.id } }">
          ← 上一节
        </RouterLink>
        <RouterLink v-if="nextLesson" class="mc-btn mc-btn--sm" :to="{ name: 'watch', params: { id: nextLesson.id } }">
          下一节 →
        </RouterLink>
      </div>
    </div>
    <div
      class="mc-progress watch__progress"
      role="progressbar"
      :aria-valuenow="watchedPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`本课时观看进度 ${watchedPercent}%`"
    >
      <div class="mc-progress__bar" :style="{ transform: `scaleX(${watchedPercent / 100})` }" />
    </div>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  border-color: transparent;
  font-size: var(--mc-text-sm);
}

.watch__lock {
  color: var(--mc-warning-fg);
  vertical-align: -2px;
}

.watch__meta {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4) var(--mc-space-5);
  font-size: var(--mc-text-sm);
}

.watch__progress {
  height: 8px;
}
</style>
