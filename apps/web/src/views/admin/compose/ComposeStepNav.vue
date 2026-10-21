<script setup lang="ts">
import { STEPS, fmtScore } from '@/composables/use-exam-compose';

/** 四步步骤条：老师的原话顺序，点任意一步直接跳转。 */
defineProps<{ step: number; paperCount: number; totalScore: number }>();
const emit = defineEmits<{ 'update:step': [step: number] }>();
</script>

<template>
  <nav class="stp" aria-label="组卷步骤">
    <button
      v-for="s in STEPS"
      :key="s.n"
      class="stp__item"
      :class="{ 'is-on': step === s.n }"
      type="button"
      @click="emit('update:step', s.n)"
    >
      <span class="stp__no">{{ s.n }}</span>
      <span class="stp__text">
        <strong>{{ s.label }}</strong>
        <em>{{ s.hint }}</em>
      </span>
    </button>
    <span class="mc-spacer" />
    <span class="stp__meta" :class="{ 'is-off': totalScore <= 0 }"
      >{{ paperCount }} 题 · {{ fmtScore(totalScore) }} 分</span
    >
  </nav>
</template>

<style scoped>
.stp {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  flex-wrap: wrap;
}

.stp__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid transparent;
  border-radius: var(--mc-radius);
  background: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.stp__item.is-on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.stp__no {
  width: 22px;
  height: 22px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--mc-text-xs);
  flex: none;
}

.stp__item.is-on .stp__no {
  background: var(--mc-primary);
  color: var(--mc-primary-fg);
}

.stp__text {
  display: flex;
  flex-direction: column;
  line-height: var(--mc-leading-display);
}

.stp__text em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.stp__meta {
  font-variant-numeric: tabular-nums;
  color: var(--mc-text-secondary);
}

.stp__meta.is-off {
  color: var(--mc-text-muted);
}
</style>
