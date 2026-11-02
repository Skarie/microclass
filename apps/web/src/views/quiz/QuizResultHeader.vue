<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import type { QuizSummary } from '@/utils/quiz';
import type { QuizSubmitResult } from '@/api/types';

/** 解析模式题头：与答题题头同一根白色细条，显示得分 / 对错数 / 返回课时 / 再练一组 */
defineProps<{
  lessonId: number;
  title: string;
  result: QuizSubmitResult;
  summary: QuizSummary;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <header class="rhead">
    <div class="rhead__row">
      <RouterLink class="rhead__back" :to="{ name: 'watch', params: { id: lessonId } }">
        <Icon name="arrow-left" :size="16" />
        <span class="rhead__back-text">返回课时</span>
      </RouterLink>

      <div class="rhead__titles">
        <h1 class="rhead__title">练习结果 · {{ title }}</h1>
        <span class="rhead__best">{{ summary.percent }}% · 历史最好 {{ result.best }}%</span>
      </div>

      <div class="rhead__score">
        <span class="rhead__score-num">{{ result.score }}</span>
        <span class="rhead__total">/ {{ result.total }}</span>
      </div>

      <div class="rhead__counts">
        <Tag tone="success">正确 {{ summary.correct }}</Tag>
        <Tag tone="danger">错误 {{ summary.wrong }}</Tag>
        <Tag v-if="summary.manual > 0" tone="warning">待自评 {{ summary.manual }}</Tag>
        <Tag v-if="summary.unanswered > 0" tone="neutral">未答 {{ summary.unanswered }}</Tag>
      </div>

      <div class="rhead__actions">
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'wrong-book' }">查看错题本</RouterLink>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('retry')">再练一组</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.rhead {
  position: sticky;
  top: var(--mc-topbar-height);
  z-index: var(--mc-z-sticky);
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--mc-space-2) var(--mc-space-4);
  border-top: 1px solid var(--mc-border);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-bg-elevated);
}

.rhead__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2) var(--mc-space-3);
}

.rhead__back {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--mc-space-1);
  height: 32px;
  padding: 0 var(--mc-space-2);
  border-radius: var(--mc-radius-xs);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  text-decoration: none;
}

.rhead__back:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.rhead__titles {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.rhead__title {
  overflow: hidden;
  color: var(--mc-text);
  font-size: var(--mc-quiz-font-size);
  font-weight: var(--mc-font-medium);
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rhead__best {
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}

.rhead__score {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-1);
}

.rhead__score-num {
  color: var(--mc-primary-fg);
  font-family: var(--mc-font-num);
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  font-variant-numeric: tabular-nums;
}

.rhead__total {
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
}

.rhead__counts,
.rhead__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2);
}

@media (max-width: 1023px) {
  .rhead {
    padding: var(--mc-space-2) var(--mc-space-3);
  }
  .rhead__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--mc-space-2) var(--mc-space-3);
  }
  .rhead__back {
    grid-column: 1;
    grid-row: 1;
  }
  .rhead__back-text {
    display: none;
  }
  .rhead__titles {
    grid-column: 2;
    grid-row: 1;
  }
  .rhead__title {
    font-size: var(--mc-quiz-font-size);
  }
  .rhead__score {
    grid-column: 3;
    grid-row: 1;
  }
  .rhead__counts {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .rhead__actions {
    grid-column: 1 / -1;
    grid-row: 3;
    width: 100%;
  }
}
</style>
