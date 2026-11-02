<script setup lang="ts">
import type { QuizQuestion } from '@/utils/quiz';
import type { SheetMode } from './quiz-types';

/**
 * 答题卡网格：练习/考试态=未答/已答/标记；解析态=正确/错误/待自评/未答；
 * 错题本态=未做/已看/已掌握。
 */
const props = withDefaults(
  defineProps<{
    questions: QuizQuestion[];
    currentIndex: number;
    answeredIds: Set<number>;
    markedIds: Set<number>;
    verdicts: Record<number, boolean | null>;
    revealed: boolean;
    mode?: SheetMode;
    masteredIds?: Set<number>;
  }>(),
  { mode: 'quiz', masteredIds: () => new Set<number>() },
);

const emit = defineEmits<{ jump: [index: number] }>();

function stateClass(q: QuizQuestion): string {
  if (props.mode === 'wrong') {
    if (props.masteredIds.has(q.id)) return 'qb--correct';
    return props.answeredIds.has(q.id) ? 'qb--done' : '';
  }
  if (props.revealed) {
    const verdict = props.verdicts[q.id];
    if (verdict === true) return 'qb--correct';
    if (verdict === false) return 'qb--wrong';
    return verdict === null ? 'qb--manual' : 'qb--unanswered';
  }
  return props.answeredIds.has(q.id) ? 'qb--done' : '';
}

function stateLabel(q: QuizQuestion): string {
  if (props.mode === 'wrong') {
    if (props.masteredIds.has(q.id)) return '（已掌握）';
    return props.answeredIds.has(q.id) ? '（已看）' : '（未做）';
  }
  if (props.revealed) {
    const verdict = props.verdicts[q.id];
    if (verdict === true) return '（正确）';
    if (verdict === false) return '（错误）';
    return verdict === null ? '（待自评）' : '';
  }
  return props.answeredIds.has(q.id) ? '（已作答）' : '（未作答）';
}
</script>

<template>
  <div class="qgrid" role="group" aria-label="题号导航">
    <button
      v-for="(q, index) in questions"
      :key="q.id"
      class="qb"
      :class="[stateClass(q), { 'qb--marked': markedIds.has(q.id) }]"
      :aria-current="index === currentIndex ? 'step' : undefined"
      :aria-label="`第 ${index + 1} 题${stateLabel(q)}${markedIds.has(q.id) ? '（已标记疑问）' : ''}`"
      type="button"
      @click="emit('jump', index)"
    >
      {{ index + 1 }}
      <span v-if="markedIds.has(q.id)" class="qb__dot" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.qgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
  gap: var(--mc-space-1);
}

.qb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0;
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition),
    color var(--mc-transition);
}

.qb:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
}

.qb--done {
  border-color: var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.qb--correct {
  border-color: var(--mc-success);
  background: var(--mc-success);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.qb--wrong {
  border-color: var(--mc-danger);
  background: var(--mc-danger);
  color: var(--mc-text-inverse);
  font-weight: var(--mc-font-semibold);
}

.qb--manual {
  border-color: var(--mc-warning);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.qb--unanswered {
  background: var(--mc-bg-sunken);
  color: var(--mc-text-muted);
}

.qb--marked {
  border-color: var(--mc-amber);
}

.qb[aria-current='step'] {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
}

.qb__dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-amber);
}
</style>
