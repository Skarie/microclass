<script setup lang="ts">
import type { useExamTake } from '@/composables/use-exam-take';

/** 底部 sticky 答题卡：已作答计数、题号跳转、交卷按钮。 */
defineProps<{ take: ReturnType<typeof useExamTake> }>();

function scrollToQuestion(qid: number): void {
  document.getElementById(`exam-q-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <footer class="take__footer mc-card">
    <div class="mc-row mc-row--wrap take__footer-row">
      <span class="mc-muted take__count">已作答 {{ take.answeredCount }} / {{ take.questions.length }}</span>
      <nav class="nav" aria-label="题目导航">
        <button
          v-for="(q, index) in take.questions"
          :key="q.id"
          class="nav__item"
          :class="{ 'nav__item--done': take.answeredIds.has(q.id) }"
          type="button"
          :aria-label="`跳转到第 ${index + 1} 题${take.answeredIds.has(q.id) ? '（已作答）' : ''}`"
          @click="scrollToQuestion(q.id)"
        >
          {{ index + 1 }}
        </button>
      </nav>
      <div class="mc-spacer" />
      <button class="mc-btn mc-btn--primary" type="button" :disabled="take.submitting" @click="take.submit(false)">
        {{ take.submitting ? '交卷中…' : '交卷' }}
      </button>
    </div>
  </footer>
</template>

<style scoped>
.take__footer {
  position: sticky;
  bottom: var(--mc-space-4);
  padding: var(--mc-space-3) var(--mc-space-5);
  z-index: var(--mc-z-sticky);
}

.take__footer-row {
  gap: var(--mc-space-3);
}

.take__count {
  font-size: var(--mc-text-sm);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-1);
  max-width: 100%;
}

.nav__item {
  min-width: 26px;
  height: 26px;
  padding: 0 var(--mc-space-1);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-xs);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition),
    color var(--mc-transition);
}

.nav__item:hover {
  background: var(--mc-bg-hover);
}

.nav__item--done {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-bold);
}
</style>
