<script setup lang="ts">
/**
 * 首页 · 我的学习看板：四个头条指标 + 等级进度（在学课程完成率）。
 * 指标与进度都由 use-home-dashboard 派生，这里只负责展示。
 */
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import type { HomeMetric } from '@/composables/use-home-dashboard';

defineProps<{
  metrics: HomeMetric[];
  level: string;
  levelHint: string;
  learningDone: number;
  learningTotal: number;
  learningPercent: number;
  learningCount: number;
}>();
</script>

<template>
  <section class="board" aria-label="我的学习数据">
    <div class="board__metrics">
      <div v-for="m in metrics" :key="m.label" class="board__metric" :class="`board__metric--${m.tone}`">
        <span class="board__label">{{ m.label }}</span>
        <span class="board__value mc-num">
          {{ m.value }}<span class="board__unit">{{ m.unit }}</span>
        </span>
      </div>
    </div>

    <div class="board__level">
      <div class="board__level-head">
        <span class="board__level-name">
          <Icon name="award" :size="15" />
          {{ level }}
        </span>
        <span class="mc-muted board__level-hint">{{ levelHint }}</span>
      </div>
      <p class="board__overall mc-muted">
        在学课程进度
        <strong class="mc-num">{{ learningDone }}/{{ learningTotal }}</strong>
        课时
        <template v-if="learningCount === 0">（暂无在学课程）</template>
      </p>
      <ProgressBar :value="learningPercent" tone="primary" :show-end="false" :label="`${learningPercent}%`" />
    </div>
  </section>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--mc-space-5);
  padding: var(--mc-space-5);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  box-shadow: none;
}

.board__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--mc-space-4);
}

.board__metric {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding-left: var(--mc-space-4);
  border-left: 1px solid var(--mc-border);
}

.board__metric:first-child {
  padding-left: 0;
  border-left: 0;
}

.board__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.board__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  color: var(--mc-text);
}

.board__unit {
  margin-left: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.board__metric--primary .board__value {
  color: var(--mc-primary-fg);
}
.board__metric--success .board__value {
  color: var(--mc-success-fg);
}
.board__metric--info .board__value {
  color: var(--mc-info-fg);
}
.board__metric--warning .board__value {
  color: var(--mc-warning-fg);
}

.board__level {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-6);
  border-left: 1px solid var(--mc-border);
}

.board__level-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.board__level-name {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.board__level-hint {
  font-size: var(--mc-text-xs);
}

.board__overall {
  margin: 0;
  font-size: var(--mc-text-xs);
}

@media (max-width: 900px) {
  .board {
    grid-template-columns: 1fr;
  }

  .board__level {
    padding-left: 0;
    border-left: 0;
    padding-top: var(--mc-space-4);
    border-top: 1px solid var(--mc-border);
  }
}
</style>
