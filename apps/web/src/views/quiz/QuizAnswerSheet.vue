<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import QuizAnswerGrid from './QuizAnswerGrid.vue';
import QuizSheetLegend from './QuizSheetLegend.vue';
import type { SheetMode } from './quiz-types';
import type { QuizSummary, QuizQuestion } from '@/utils/quiz';

/** 泛雅式答题卡内容：分组网格 + 底部图例 + 随机题数（桌面停靠面板与移动抽屉共用） */
const props = withDefaults(
  defineProps<{
    questions: QuizQuestion[];
    currentIndex: number;
    answeredIds: Set<number>;
    markedIds: Set<number>;
    verdicts: Record<number, boolean | null>;
    revealed: boolean;
    count: number;
    summary: QuizSummary;
    /** 错题本：未做/已看/已掌握；练习/考试：未答/已答/标记 */
    mode?: SheetMode;
    masteredIds?: Set<number>;
    /** 错题本/考试没有随机题数可换 */
    showCount?: boolean;
    /** 抽屉里需要关闭按钮；桌面停靠面板不需要 */
    closable?: boolean;
  }>(),
  { mode: 'quiz', masteredIds: () => new Set<number>(), showCount: true },
);

const emit = defineEmits<{
  jump: [index: number];
  close: [];
  'change-count': [count: number];
}>();

const answered = computed(() => props.answeredIds.size);
const mastered = computed(() => props.questions.filter((q) => props.masteredIds.has(q.id)).length);
const manual = computed(() => props.summary.manual);
const countLabel = computed(() => (props.mode === 'wrong' ? '已看' : '已答'));
const resultLine = computed(
  () =>
    `正确 ${props.summary.correct} · 错误 ${props.summary.wrong}${manual.value > 0 ? ` · 待自评 ${manual.value}` : ''}`,
);
const footLine = computed(() => {
  if (props.mode === 'wrong') return `已掌握 ${mastered.value} / ${props.questions.length}`;
  return props.revealed ? resultLine.value : '';
});

function onCountChange(event: Event): void {
  emit('change-count', Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <div class="sheet">
    <div class="sheet__head">
      <span class="sheet__title">答题卡</span>
      <span class="sheet__count">{{ countLabel }} {{ answered }} / {{ questions.length }}</span>
      <button
        v-if="closable !== false"
        class="sheet__close"
        type="button"
        aria-label="关闭答题卡"
        @click="emit('close')"
      >
        <Icon name="close" :size="16" />
      </button>
    </div>

    <div class="sheet__body">
      <QuizAnswerGrid
        :questions="questions"
        :current-index="currentIndex"
        :answered-ids="answeredIds"
        :marked-ids="markedIds"
        :verdicts="verdicts"
        :revealed="revealed"
        :mode="mode"
        :mastered-ids="masteredIds"
        @jump="emit('jump', $event)"
      />
    </div>

    <QuizSheetLegend :revealed="revealed" :manual="manual" :mode="mode" />

    <div v-if="footLine || (!revealed && showCount !== false)" class="sheet__foot">
      <div v-if="!revealed && showCount !== false" class="sheet__random">
        <label class="sheet__random-label" for="quiz-random-count">随机题数</label>
        <select id="quiz-random-count" class="mc-select sheet__select" :value="count" @change="onCountChange">
          <option :value="0">全部</option>
          <option v-for="n in [5, 10, 20, 30]" :key="n" :value="n">{{ n }} 题</option>
        </select>
      </div>
      <p v-if="!revealed && showCount !== false" class="sheet__hint">换一组会清空当前作答与标记</p>
      <span v-if="footLine" class="sheet__foot-line">{{ footLine }}</span>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  height: 100%;
  min-height: 0;
}

.sheet__head,
.sheet__foot {
  flex: none;
}

.sheet__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.sheet__title {
  color: var(--mc-text);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
}

.sheet__count {
  flex: 1;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}

.sheet__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
}

.sheet__close:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

/* 题号多时只有中间网格滚动，底部图例与随机题数保持可见 */
.sheet__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--mc-space-3);
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--mc-space-1);
}

.sheet__foot {
  padding-top: var(--mc-space-2);
  border-top: 1px solid var(--mc-border);
}

.sheet__random {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.sheet__random-label {
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
}

.sheet__select {
  width: 92px;
  height: 28px;
  padding: 0 var(--mc-space-2);
  font-size: var(--mc-text-xs);
}

.sheet__hint {
  margin: var(--mc-space-1) 0 0;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}

.sheet__foot-line {
  display: block;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
