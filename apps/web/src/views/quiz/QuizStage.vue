<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import QuizActionBar from './QuizActionBar.vue';
import QuizAnswerDock from './QuizAnswerDock.vue';
import QuizQuestionCard from './QuizQuestionCard.vue';
import { useQuizHotkeys } from '@/composables/use-quiz-hotkeys';
import type { useQuizSession } from '@/composables/use-quiz-session';

/** 刷题主区：单题卡片 + 底部操作条 + 右侧答题卡/移动抽屉 */
const props = defineProps<{ session: ReturnType<typeof useQuizSession> }>();

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

const current = computed(() => props.session.current);
const currentAnswer = computed(() => {
  const q = current.value;
  return q ? (props.session.answers[q.id] ?? '') : '';
});
const currentPicked = computed(() => (current.value ? props.session.pickedOf(current.value.id) : []));
const currentMarked = computed(() => (current.value ? props.session.isMarked(current.value.id) : false));
const currentGraded = computed(() => (current.value ? (props.session.resultMap.get(current.value.id) ?? null) : null));

function onInput(value: string): void {
  const q = current.value;
  if (q) props.session.setAnswer(q.id, value);
}

function onMark(): void {
  const q = current.value;
  if (q) props.session.toggleMark(q.id);
}

function openCard(): void {
  if (narrow.value) drawerOpen.value = true;
  else sheetOpen.value = !sheetOpen.value;
}

useQuizHotkeys({
  current: () => current.value,
  result: () => props.session.result,
  choose: props.session.choose,
  next: props.session.next,
  prev: props.session.prev,
  blocked: () => drawerOpen.value,
});
</script>

<template>
  <div class="quiz__body" :class="{ 'quiz__body--solo': !sheetOpen }">
    <div class="quiz__main">
      <QuizQuestionCard
        v-if="current"
        :q="current"
        :index="session.currentIndex"
        :answer="currentAnswer"
        :picked="currentPicked"
        :marked="currentMarked"
        :graded="currentGraded"
        :disabled="Boolean(session.result)"
        @pick="session.choose"
        @input="onInput"
        @mark="onMark"
      />
      <QuizActionBar
        :index="session.currentIndex"
        :total="session.questions.length"
        :marked="currentMarked"
        :revealed="Boolean(session.result)"
        :submitting="session.submitting"
        :unlocked="session.unlocked"
        @prev="session.prev"
        @next="session.next"
        @mark="onMark"
        @card="openCard"
        @submit="session.submit"
      />
    </div>

    <QuizAnswerDock
      :session="session"
      :open="sheetOpen"
      :drawer-open="drawerOpen"
      @close-sheet="sheetOpen = false"
      @close-drawer="drawerOpen = false"
    />
  </div>
</template>

<style scoped>
.quiz__body {
  display: grid;
  grid-template-columns: minmax(0, 900px) 240px;
  gap: var(--mc-space-5);
  align-items: start;
  justify-content: center;
}

.quiz__body--solo {
  grid-template-columns: minmax(0, 900px);
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
  }
}
</style>
