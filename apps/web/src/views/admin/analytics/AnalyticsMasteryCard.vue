<script setup lang="ts">
import { computed } from 'vue';
import DonutChart from '@/components/charts/DonutChart.vue';
import type { MasterySegment } from './analytics-types';

/**
 * 掌握度分布卡：环形面积 = 知识点占比，图标 = 该档结论。
 * 分档口径写在卡片底部（与后端阈值一致，数据不足单独一档）。
 */
const props = defineProps<{ segments: MasterySegment[]; total: number }>();

const caption = computed(
  () => `掌握度分布：${props.segments.map((s) => `${s.label} ${s.value} 个`).join('，')}（共 ${props.total} 个）`,
);
</script>

<template>
  <div class="mc-card ana__mastery">
    <div class="mc-card__title-row">
      <span class="mc-card__title">掌握度分布</span>
      <span class="mc-muted ana__titlehint">环形面积 = 知识点占比，图标 = 该档结论</span>
    </div>
    <DonutChart :segments="segments" :center-value="total" center-label="个知识点" :caption="caption" />
    <p class="mc-hint">
      分档口径：作答 ≥ 3 次才下结论；正确率 ≥ 80% 为掌握、60–80% 为薄弱、&lt; 60% 为未掌握；不足 3
      次统一标为「数据不足」。
    </p>
  </div>
</template>

<style scoped>
/* 卡片内边距：这张卡直接在 .mc-card 里放内容，没有走 __header/__body，必须自己留白 */
.ana__mastery {
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
  .ana__mastery {
    padding: var(--mc-space-4);
  }
}
</style>
