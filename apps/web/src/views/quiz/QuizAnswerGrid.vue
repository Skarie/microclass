<script setup lang="ts">
import { computed } from 'vue';
import { groupQuestionsByType } from './quiz-groups';
import type { QuizQuestion } from '@/utils/quiz';
import type { SheetMode } from './quiz-types';

/**
 * 泛雅式答题卡：按题型分组（组序 = 题型首次出现顺序，组内保持原题号），
 * 每组 8 列 × 28px 紧凑网格；练习/考试=未答/已答/标记，解析=对错，错题本=未做/已看/已掌握。
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

const groups = computed(() => groupQuestionsByType(props.questions));

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
  <div class="qgroups">
    <div
      v-for="group in groups"
      :key="group.type"
      class="qgroup"
      role="group"
      :aria-label="`${group.label}，共 ${group.items.length} 题`"
    >
      <div class="qgroup__head">
        <span class="qgroup__title">{{ group.label }}</span>
        <span class="qgroup__meta">{{ group.items.length }} 题</span>
        <span class="qgroup__line" aria-hidden="true" />
      </div>

      <div class="qgrid">
        <button
          v-for="item in group.items"
          :key="item.q.id"
          class="qb"
          :class="[stateClass(item.q), { 'qb--marked': markedIds.has(item.q.id) }]"
          :aria-current="item.index === currentIndex ? 'step' : undefined"
          :aria-label="`第 ${item.index + 1} 题${stateLabel(item.q)}${markedIds.has(item.q.id) ? '（已标记疑问）' : ''}`"
          type="button"
          @click="emit('jump', item.index)"
        >
          {{ item.index + 1 }}
          <span v-if="markedIds.has(item.q.id)" class="qb__dot" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qgroups {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}
.qgroup__head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-3);
}
.qgroup__title {
  color: var(--mc-text);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
}
.qgroup__meta {
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}
.qgroup__line {
  flex: 1;
  height: 1px;
  background: var(--mc-border);
}
.qgrid {
  display: grid;
  grid-template-columns: repeat(8, 28px);
  gap: var(--mc-space-1);
  align-content: start;
  justify-content: start;
}
.qb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
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
  outline-offset: 1px;
}
.qb--done {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
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
  border-color: var(--mc-warning-border);
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
  border-color: var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  box-shadow: inset 0 0 0 2px var(--mc-bg-elevated);
  font-weight: var(--mc-font-semibold);
}
.qb__dot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  border: 1px solid var(--mc-bg-elevated);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-amber);
}
</style>

@media (max-width: 1023px) { /* 抽屉里题号格子按 6 列排，单格不小于 44px 触控目标 */ .qgrid { grid-template-columns:
repeat(6, 1fr); } .qb { width: 100%; height: 44px; } }
