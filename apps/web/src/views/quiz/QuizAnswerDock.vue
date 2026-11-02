<script setup lang="ts">
import { computed } from 'vue';
import QuizAnswerDrawer from './QuizAnswerDrawer.vue';
import QuizAnswerSheet from './QuizAnswerSheet.vue';
import type { useQuizSession } from '@/composables/use-quiz-session';

/**
 * 答题卡停靠区：桌面右侧粘性面板 + 移动端底部抽屉，
 * 两者共用同一份 QuizAnswerSheet 内容与状态。
 */
const props = defineProps<{
  session: ReturnType<typeof useQuizSession>;
  open: boolean;
  drawerOpen: boolean;
}>();

const emit = defineEmits<{ 'close-sheet': []; 'close-drawer': [] }>();

const sheetProps = computed(() => ({
  questions: props.session.questions,
  currentIndex: props.session.currentIndex,
  answeredIds: props.session.answeredIds,
  markedIds: props.session.markedIds,
  verdicts: props.session.verdicts,
  revealed: Boolean(props.session.result),
  count: props.session.count,
  unlocked: props.session.unlocked,
  submitting: props.session.submitting,
  summary: props.session.summary,
}));

function jump(index: number): void {
  props.session.goTo(index);
  emit('close-drawer');
}

async function submit(): Promise<void> {
  const ok = await props.session.submit();
  if (ok) emit('close-drawer');
}

function changeCount(value: number): void {
  emit('close-drawer');
  props.session.retry(value);
}
</script>

<template>
  <aside v-if="open" class="quiz__aside mc-card">
    <QuizAnswerSheet
      v-bind="sheetProps"
      @jump="jump"
      @submit="submit"
      @close="emit('close-sheet')"
      @change-count="changeCount"
    />
  </aside>

  <QuizAnswerDrawer :open="drawerOpen" @close="emit('close-drawer')">
    <QuizAnswerSheet
      v-bind="sheetProps"
      @jump="jump"
      @submit="submit"
      @close="emit('close-drawer')"
      @change-count="changeCount"
    />
  </QuizAnswerDrawer>
</template>

<style scoped>
.quiz__aside {
  position: sticky;
  top: calc(var(--mc-topbar-height) + var(--mc-space-12) + var(--mc-space-8) + var(--mc-space-4));
  display: flex;
  flex-direction: column;
  max-height: calc(
    100vh - var(--mc-topbar-height) - var(--mc-space-12) - var(--mc-space-8) - var(--mc-space-4) - var(--mc-space-4)
  );
  padding: var(--mc-space-4);
  overflow-y: auto;
}

@media (max-width: 1023px) {
  .quiz__aside {
    display: none;
  }
}
</style>
