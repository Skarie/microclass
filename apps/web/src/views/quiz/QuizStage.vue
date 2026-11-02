<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import QuizActionBar from './QuizActionBar.vue';
import QuizAnswerDock from './QuizAnswerDock.vue';
import QuizQuestionCard from './QuizQuestionCard.vue';
import { useQuizHotkeys } from '@/composables/use-quiz-hotkeys';
import type { QuizFlowState } from '@/composables/use-quiz-flow';

/**
 * 单题流主区：单题卡片 + 底部操作条 + 右侧答题卡/移动抽屉。
 * 练习、考试、错题本共用；页面用 after-question 插槽追加各自的操作（如看解析/标记掌握）。
 */
const props = withDefaults(
  defineProps<{
    flow: QuizFlowState;
    mode?: 'quiz' | 'wrong' | 'exam';
    showCount?: boolean;
    showSubmit?: boolean;
    showMark?: boolean;
  }>(),
  { mode: 'quiz', showCount: true, showSubmit: true, showMark: true },
);

const drawerOpen = ref(false);
const sheetOpen = ref(true);
const narrow = ref(false);

let mediaQuery: MediaQueryList | null = null;
function syncNarrow(): void {
  narrow.value = mediaQuery?.matches ?? false;
}
onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 1023px)');
  syncNarrow();
  mediaQuery.addEventListener('change', syncNarrow);
});
onBeforeUnmount(() => mediaQuery?.removeEventListener('change', syncNarrow));

const current = computed(() => props.flow.current);
const currentAnswer = computed(() => {
  const q = current.value;
  return q ? (props.flow.answers[q.id] ?? '') : '';
});
const currentPicked = computed(() => (current.value ? props.flow.pickedOf(current.value.id) : []));
const currentMarked = computed(() => (current.value ? props.flow.isMarked(current.value.id) : false));
const currentGraded = computed(() => (current.value ? props.flow.gradedOf(current.value.id) : null));

function onInput(value: string): void {
  const q = current.value;
  if (q) props.flow.setAnswer(q.id, value);
}

function onMark(): void {
  const q = current.value;
  if (q) props.flow.toggleMark(q.id);
}

function openCard(): void {
  if (narrow.value) drawerOpen.value = true;
  else sheetOpen.value = !sheetOpen.value;
}

useQuizHotkeys({
  current: () => current.value,
  revealed: () => props.flow.revealed,
  choose: (value) => props.flow.choose(value),
  next: () => props.flow.next(),
  prev: () => props.flow.prev(),
  blocked: () => drawerOpen.value,
});
</script>

<template>
  <div class="quiz__body" :class="{ 'quiz__body--solo': !sheetOpen }">
    <div class="quiz__main">
      <QuizQuestionCard
        v-if="current"
        :q="current"
        :index="flow.currentIndex"
        :answer="currentAnswer"
        :picked="currentPicked"
        :marked="currentMarked"
        :graded="currentGraded"
        :disabled="Boolean(currentGraded)"
        :markable="showMark"
        @pick="flow.choose"
        @input="onInput"
        @mark="onMark"
      />

      <slot name="after-question" />

      <QuizActionBar
        :index="flow.currentIndex"
        :total="flow.questions.length"
        :marked="currentMarked"
        :revealed="flow.revealed"
        :submitting="flow.submitting"
        :unlocked="flow.unlocked"
        :show-mark="showMark"
        :show-submit="showSubmit"
        @prev="flow.prev"
        @next="flow.next"
        @mark="onMark"
        @card="openCard"
        @submit="flow.submit"
      />
    </div>

    <QuizAnswerDock
      :flow="flow"
      :open="sheetOpen"
      :drawer-open="drawerOpen"
      :mode="mode"
      :show-count="showCount"
      :show-submit="showSubmit"
      @close-sheet="sheetOpen = false"
      @close-drawer="drawerOpen = false"
    />
  </div>
</template>

<style scoped>
.quiz__body {
  display: grid;
  grid-template-columns: minmax(0, 800px) 260px;
  gap: var(--mc-space-5);
  align-items: start;
  justify-content: center;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
}

.quiz__body--solo {
  grid-template-columns: minmax(0, 800px);
  max-width: 800px;
}

.quiz__main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  min-width: 0;
}

@media (max-width: 1279px) {
  .quiz__body {
    grid-template-columns: minmax(0, 1fr) 220px;
  }

  .quiz__body--solo {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1023px) {
  .quiz__body {
    grid-template-columns: minmax(0, 1fr);
    padding-bottom: calc(var(--mc-space-12) + var(--mc-space-10));
  }
}
</style>
