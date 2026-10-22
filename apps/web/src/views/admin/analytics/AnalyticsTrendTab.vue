<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import TrendChart from '@/components/charts/TrendChart.vue';
import type { AnalyticsOverview } from './analytics-types';

/** 作答趋势页签：柱 = 每天作答量，折线 = 正确率（数据来自 overview.trend，不额外请求）。 */
defineProps<{ trend: AnalyticsOverview['trend'] }>();
</script>

<template>
  <div class="mc-card ana__panel">
    <template v-if="trend.length > 0">
      <div class="mc-card__title-row">
        <span class="mc-card__title">作答趋势（柱 = 每天作答量，折线 = 正确率）</span>
        <span class="mc-muted ana__titlehint">鼠标移到柱子上看当天明细</span>
      </div>
      <TrendChart :data="trend" :height="240" />
    </template>
    <EmptyState
      v-else
      icon="trendingUp"
      title="范围内没有作答记录"
      description="学员开始做题后，这里会显示每天的作答量与正确率趋势。"
    />
  </div>
</template>

<style scoped>
/* 卡片内边距：直接在 .mc-card 里放内容，没有走 __header/__body，必须自己留白 */
.ana__panel {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-6);
}

/* 标题行：标题 + 灰度说明，宽屏同行，窄屏换行，绝不再贴边 */
.mc-card__title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--mc-space-1) var(--mc-space-3);
  margin-bottom: var(--mc-space-3);
}

.mc-card__title-row .mc-card__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-snug);
}

/* 标题旁说明文字：次要色、小一号、可换行 */
.ana__titlehint {
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
}

@media (max-width: 720px) {
  .ana__panel {
    padding: var(--mc-space-4);
  }
}
</style>
