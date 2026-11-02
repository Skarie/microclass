<script setup lang="ts">
import type { SheetMode } from './quiz-types';

/** 答题卡图例：错题本=未做/已看/已掌握；练习/考试=未答/已答/标记（解析态换对错） */
withDefaults(defineProps<{ revealed: boolean; manual: number; mode?: SheetMode }>(), { mode: 'quiz' });
</script>

<template>
  <div class="legend">
    <template v-if="mode === 'wrong'">
      <span class="legend__item"><i class="legend__swatch legend__swatch--idle" />未做</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--done" />已看</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--correct" />已掌握</span>
    </template>
    <template v-else-if="!revealed">
      <span class="legend__item"><i class="legend__swatch legend__swatch--idle" />未答</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--done" />已答</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--mark" />标记</span>
    </template>
    <template v-else>
      <span class="legend__item"><i class="legend__swatch legend__swatch--correct" />正确</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--wrong" />错误</span>
      <span v-if="manual > 0" class="legend__item"><i class="legend__swatch legend__swatch--manual" />待自评</span>
      <span class="legend__item"><i class="legend__swatch legend__swatch--idle" />未答</span>
    </template>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2) var(--mc-space-3);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}

.legend__item {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
}

.legend__swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-xs);
}

.legend__swatch--idle {
  background: var(--mc-bg-sunken);
}

.legend__swatch--done {
  border-color: var(--mc-primary);
  background: var(--mc-primary);
}

.legend__swatch--mark {
  border-color: var(--mc-amber);
  background: var(--mc-amber);
}

.legend__swatch--correct {
  border-color: var(--mc-success);
  background: var(--mc-success);
}

.legend__swatch--wrong {
  border-color: var(--mc-danger);
  background: var(--mc-danger);
}

.legend__swatch--manual {
  border-color: var(--mc-warning);
  background: var(--mc-warning-soft);
}
</style>
