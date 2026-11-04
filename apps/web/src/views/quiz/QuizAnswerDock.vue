<script setup lang="ts">
import { computed } from 'vue';
import QuizAnswerDrawer from './QuizAnswerDrawer.vue';
import QuizAnswerSheet from './QuizAnswerSheet.vue';
import type { SheetMode } from './quiz-types';
import type { QuizFlowState } from '@/composables/use-quiz-flow';

/**
 * 答题卡停靠区：桌面右侧粘性面板 + 移动端底部抽屉，
 * 两者共用同一份 QuizAnswerSheet 内容与状态；语义（练习/考试/错题本）由 mode 决定。
 */
const props = withDefaults(
  defineProps<{
    flow: QuizFlowState;
    open: boolean;
    drawerOpen: boolean;
    /** 错题本展示未做/已看/已掌握；练习与考试展示未答/已答/标记 */
    mode?: 'quiz' | 'wrong' | 'exam';
    showCount?: boolean;
  }>(),
  { mode: 'quiz', showCount: true },
);

const emit = defineEmits<{ 'close-sheet': []; 'close-drawer': [] }>();

const sheetMode = computed<SheetMode>(() => (props.mode === 'wrong' ? 'wrong' : 'quiz'));
const sheetProps = computed(() => ({
  questions: props.flow.questions,
  currentIndex: props.flow.currentIndex,
  answeredIds: props.flow.answeredIds,
  markedIds: props.flow.markedIds,
  verdicts: props.flow.verdicts,
  revealed: props.flow.revealed,
  count: props.flow.count,
  summary: props.flow.summary,
  mode: sheetMode.value,
  masteredIds: props.flow.masteredIds,
  showCount: props.showCount,
}));

function jump(index: number): void {
  props.flow.goTo(index);
  emit('close-drawer');
}

function changeCount(value: number): void {
  emit('close-drawer');
  props.flow.retry?.(value);
}
</script>

<template>
  <aside v-if="open" class="quiz__aside mc-card">
    <QuizAnswerSheet
      v-bind="sheetProps"
      :closable="false"
      @jump="jump"
      @close="emit('close-sheet')"
      @change-count="changeCount"
    />
  </aside>

  <QuizAnswerDrawer :open="drawerOpen" @close="emit('close-drawer')">
    <QuizAnswerSheet v-bind="sheetProps" @jump="jump" @close="emit('close-drawer')" @change-count="changeCount" />
  </QuizAnswerDrawer>
</template>

<style scoped>
.quiz__aside {
  position: sticky;
  top: calc(var(--mc-topbar-height) + var(--mc-space-12) + var(--mc-space-4));
  display: flex;
  flex-direction: column;
  /* 题少时按内容自然高度；题多时才由 max-height 收口，网格内部滚动 */
  max-height: min(72vh, 640px);
  max-height: min(72dvh, 640px);
  padding: var(--mc-space-3);
  border-radius: var(--mc-radius-xs);
  box-shadow: var(--mc-shadow-xs);
  overflow: hidden;
}

@media (max-width: 1023px) {
  .quiz__aside {
    display: none;
  }
}
</style>
