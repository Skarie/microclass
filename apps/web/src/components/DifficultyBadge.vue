<script setup lang="ts">
/**
 * 难度徽章：五级文字等级 + 5 段刻度 + 分数 + 来源。
 *
 * 为什么三种信息都给：分数是模型算出来的连续量（排序/分档用），
 * 五级文字是老师一眼能比的粗档，5 段方块只做辅助刻度（不用星星）；
 * 来源说明这条难度是**模型先验**、**作答数据校准**还是**老师手改**——
 * 老师需要知道哪个能信、哪个该复核。
 */
import { computed } from 'vue';
import { LEVEL_LABEL, difficultySourceLabel, levelFromScore } from '@/composables/difficulty';

const props = withDefaults(
  defineProps<{
    /** 0–100；-1 或未提供表示还没算过 */
    score?: number;
    /** 三档（easy/medium/hard），用于兜底显示 */
    difficulty?: string;
    /** auto / calibrated / manual */
    source?: string;
    /** 参与校准的作答样本数 */
    samples?: number;
    /** 紧凑模式（列表里用，不显示分数与来源文字） */
    compact?: boolean;
  }>(),
  { score: -1, difficulty: '', source: '', samples: 0, compact: false },
);

const hasScore = computed(() => Number.isFinite(props.score) && (props.score ?? -1) >= 0);

/** 五级：有分数走统一阈值，只有粗档时按 easy/medium/hard 兜底 */
const level = computed(() => {
  if (hasScore.value) return levelFromScore(props.score);
  return props.difficulty === 'easy' ? 1 : props.difficulty === 'hard' ? 5 : props.difficulty === 'medium' ? 3 : 0;
});

const label = computed(() => LEVEL_LABEL[level.value] ?? '未评估');
const sourceLabel = computed(() => difficultySourceLabel(props.source));
</script>

<template>
  <span class="diff" :class="`diff--l${level}`" :title="`${label}${hasScore ? ` · ${score}/100` : ''}`">
    <span v-if="level > 0" class="diff__scale" aria-hidden="true">
      <i v-for="n in 5" :key="n" :class="{ 'is-on': n <= level }" />
    </span>
    <span class="diff__label">{{ label }}</span>
    <span v-if="!compact && hasScore" class="diff__score">{{ score }}</span>
    <span v-if="sourceLabel" class="diff__source" :class="`diff__source--${source}`">{{ sourceLabel }}</span>
    <span v-if="sourceLabel === '校准' && samples > 0" class="diff__samples">{{ samples }} 次作答</span>
  </span>
</template>

<style scoped>
.diff {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: var(--mc-text-xs);
}

.diff__scale {
  display: inline-flex;
  gap: 1px;
}

.diff__scale i {
  width: 6px;
  height: 6px;
  background: var(--mc-border);
}

.diff__scale i.is-on {
  background: var(--mc-text-secondary);
}

.diff--l1 .diff__scale i.is-on,
.diff--l2 .diff__scale i.is-on {
  background: var(--mc-success-fg);
}

.diff--l3 .diff__scale i.is-on {
  background: var(--mc-warning-fg);
}

.diff--l4 .diff__scale i.is-on,
.diff--l5 .diff__scale i.is-on {
  background: var(--mc-danger-fg);
}

.diff__label {
  color: var(--mc-text-secondary, inherit);
}

.diff__score {
  font-variant-numeric: tabular-nums;
  color: var(--mc-text-secondary, inherit);
}

.diff__source {
  padding: 0 4px;
  border-radius: var(--mc-radius-sm);
  border: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
}

.diff__source--manual {
  border-color: var(--mc-primary);
  color: var(--mc-primary-fg);
}

.diff__source--calibrated {
  border-color: var(--mc-success-fg);
  color: var(--mc-success-fg);
}

.diff__samples {
  color: var(--mc-text-secondary, inherit);
  font-size: var(--mc-text-xs);
}
</style>
