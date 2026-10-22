<script setup lang="ts">
import BarList from '@/components/charts/BarList.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import type { BarItem } from '@/components/charts/types';
import type { WrongResponse } from './analytics-types';

/**
 * 高频错题页签：最少作答筛选 + 错误率排行（威尔逊置信下界排序在服务端完成）。
 * 条越长越该讲，颜色 = 严重程度。
 */
defineProps<{ wrong: WrongResponse | null; bars: BarItem[]; minAttempts: number }>();
const emit = defineEmits<{ minChange: [minAttempts: number] }>();

function onMinChange(e: Event): void {
  emit('minChange', Number((e.target as HTMLSelectElement).value));
}
</script>

<template>
  <div class="mc-card ana__panel">
    <div class="ana__filterline">
      <label class="ana__field">
        <span class="mc-label">最少作答</span>
        <select class="mc-select" :value="minAttempts" aria-label="最少作答次数" @change="onMinChange">
          <option :value="1">1 次（含噪声）</option>
          <option :value="2">2 次</option>
          <option :value="3">3 次</option>
          <option :value="5">5 次</option>
        </select>
      </label>
      <span class="mc-muted">排序用威尔逊置信下界：样本少的自动降权，避免"答 1 次错 1 次"霸榜</span>
    </div>
    <template v-if="wrong && wrong.questions.length > 0">
      <div class="mc-card__title-row">
        <span class="mc-card__title">错误率排行（条越长越该讲，颜色 = 严重程度）</span>
        <span class="mc-muted ana__titlehint"><Icon name="flame" :size="14" /> 共 {{ wrong.questions.length }} 道</span>
      </div>
      <BarList :items="bars" :limit="20" caption="高频错题错误率排行" />
      <p class="mc-hint">{{ wrong.dataNote }}</p>
    </template>
    <EmptyState
      v-else
      icon="alert"
      title="没有满足条件的错题"
      :description="wrong?.dataNote ?? '把「最少作答」调到 1 可以查看全部有作答的题目。'"
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

.ana__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
}

.ana__filterline {
  display: flex;
  align-items: flex-end;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
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
