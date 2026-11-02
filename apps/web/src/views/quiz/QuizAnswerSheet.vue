<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import QuizAnswerGrid from './QuizAnswerGrid.vue';
import QuizSheetLegend from './QuizSheetLegend.vue';
import type { SheetMode } from './quiz-types';
import type { QuizSummary, QuizQuestion } from '@/utils/quiz';

/** 答题卡内容：网格 + 图例 + 随机题数 + 底部计数/交卷（桌面面板与移动抽屉共用） */
const props = withDefaults(
  defineProps<{
    questions: QuizQuestion[];
    currentIndex: number;
    answeredIds: Set<number>;
    markedIds: Set<number>;
    verdicts: Record<number, boolean | null>;
    revealed: boolean;
    count: number;
    unlocked: boolean;
    submitting: boolean;
    summary: QuizSummary;
    /** 错题本：未做/已看/已掌握；练习/考试：未答/已答/标记 */
    mode?: SheetMode;
    masteredIds?: Set<number>;
    /** 错题本/考试没有随机题数可换 */
    showCount?: boolean;
    showSubmit?: boolean;
  }>(),
  { mode: 'quiz', masteredIds: () => new Set<number>(), showCount: true, showSubmit: true },
);

const emit = defineEmits<{
  jump: [index: number];
  submit: [];
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

function onCountChange(event: Event): void {
  emit('change-count', Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <div class="sheet">
    <div class="sheet__head">
      <span class="sheet__title">答题卡</span>
      <span class="sheet__count">{{ countLabel }} {{ answered }} / {{ questions.length }}</span>
      <button class="sheet__close" type="button" aria-label="关闭答题卡" @click="emit('close')">
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

      <QuizSheetLegend :revealed="revealed" :manual="manual" :mode="mode" />

      <label v-if="!revealed && showCount !== false" class="sheet__random">
        <span>随机题数</span>
        <select class="mc-select sheet__select" :value="count" @change="onCountChange">
          <option :value="0">全部</option>
          <option v-for="n in [5, 10, 20, 30]" :key="n" :value="n">{{ n }} 题</option>
        </select>
      </label>
    </div>

    <div class="sheet__foot">
      <template v-if="!revealed && showSubmit !== false">
        <span class="sheet__foot-count">{{ countLabel }} {{ answered }} / {{ questions.length }}</span>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="submitting || !unlocked"
          @click="emit('submit')"
        >
          {{ submitting ? '提交中…' : '交卷' }}
        </button>
      </template>
      <template v-else-if="mode === 'wrong'">
        <span class="sheet__foot-count">已掌握 {{ mastered }} / {{ questions.length }}</span>
      </template>
      <template v-else>
        <span class="sheet__foot-count">{{ resultLine }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  min-height: 0;
  height: 100%;
}

/* 题号多时只有中间网格滚动，标题与底部交卷保持可见 */
.sheet__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--mc-space-1);
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
  font-size: var(--mc-text-md);
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
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
}

.sheet__close:hover {
  background: var(--mc-bg-hover);
}

.sheet__body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.sheet__random {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}

.sheet__select {
  width: 100px;
}

.sheet__foot {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
}

.sheet__foot-count {
  flex: 1;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
