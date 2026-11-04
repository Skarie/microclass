<script setup lang="ts">
import { computed } from 'vue';
import DifficultyBadge from '@/components/DifficultyBadge.vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import Tag from '@/components/Tag.vue';
import QuizAnswerReview from './QuizAnswerReview.vue';
import QuizChoiceOptions from './QuizChoiceOptions.vue';
import QuizFillInput from './QuizFillInput.vue';
import { QUIZ_TYPE_LABEL, legacyImageUrl, type QuizQuestion } from '@/utils/quiz';
import type { GradedItem } from '@/api/types';

/**
 * 泛雅式单题卡片：题号 / 小号题型 pill / 难度 + 15px 题干 + 紧凑选项 / 填空 / 简答。
 * 解析模式下追加「你的作答 / 参考答案 / 解析」，选项同时标出对错。
 */
const props = defineProps<{
  q: QuizQuestion;
  index: number;
  answer: string;
  picked: string[];
  marked: boolean;
  graded: GradedItem | null;
  disabled: boolean;
  /** 错题本/考试等不需要「标记疑问」时传 false */
  markable?: boolean;
}>();

const emit = defineEmits<{
  pick: [value: string];
  input: [value: string];
  mark: [];
}>();

const typeLabel = computed(() => QUIZ_TYPE_LABEL[props.q.type]);
const hasDifficulty = computed(() => (props.q.difficulty_score ?? -1) >= 0 || Boolean(props.q.difficulty));
const imageUrl = computed(() => legacyImageUrl(props.q));
const verdict = computed(() => {
  if (props.graded?.correct === true) return '正确';
  if (props.graded?.correct === false) return '错误';
  return '待自评';
});

function onTextInput(event: Event): void {
  emit('input', (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <article id="quiz-question" class="question mc-card" :class="{ 'question--revealed': Boolean(graded) }">
    <header class="question__head">
      <span class="question__index">{{ index + 1 }}</span>
      <Tag tone="primary" size="sm">{{ typeLabel }}</Tag>
      <DifficultyBadge
        v-if="hasDifficulty"
        compact
        :score="q.difficulty_score"
        :difficulty="q.difficulty"
        :source="q.difficulty_source"
        :samples="q.difficulty_n"
      />
      <span
        v-if="graded"
        class="mc-badge"
        :class="graded.correct === true ? 'mc-badge--success' : graded.correct === false ? 'mc-badge--danger' : ''"
      >
        {{ verdict }}
      </span>
      <span class="mc-spacer" />
      <button
        v-if="!graded && markable !== false"
        class="question__mark"
        :class="{ 'question__mark--on': marked }"
        type="button"
        @click="emit('mark')"
      >
        <Icon name="helpCircle" :size="14" />
        {{ marked ? '已标记' : '标记疑问' }}
      </button>
    </header>

    <RichText class="question__stem" :text="q.stem" figure-images />

    <img v-if="imageUrl" class="question__image" :src="imageUrl" :alt="`第 ${index + 1} 题配图`" loading="lazy" />

    <QuizChoiceOptions
      v-if="q.type === 'single' || q.type === 'multiple' || q.type === 'judge'"
      :q="q"
      :answer="answer"
      :picked="picked"
      :graded="graded"
      :disabled="disabled"
      @pick="emit('pick', $event)"
    />

    <QuizFillInput
      v-else-if="q.type === 'fill'"
      :model-value="answer"
      :blanks="q.blanks"
      :disabled="disabled"
      @update:model-value="emit('input', $event)"
    />

    <textarea
      v-else
      class="mc-textarea"
      :value="answer"
      :disabled="disabled"
      placeholder="请作答（简答题不自动判分，可与参考答案自行比对）"
      @input="onTextInput"
    />

    <QuizAnswerReview v-if="graded" :q="q" :graded="graded" />
  </article>
</template>

<style scoped>
.question {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  padding: var(--mc-space-5);
  border-radius: var(--mc-radius-xs);
  box-shadow: var(--mc-shadow-xs);
  scroll-margin-top: calc(var(--mc-topbar-height) + var(--mc-space-12) + var(--mc-space-8) + var(--mc-space-4));
}
.question__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2);
}
.question__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 var(--mc-space-1);
  border-radius: var(--mc-radius-xs);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  font-variant-numeric: tabular-nums;
}
.question__stem {
  color: var(--mc-text);
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-medium);
  line-height: var(--mc-quiz-line-height);
  white-space: pre-wrap;
}
.question__image {
  max-width: 100%;
  max-height: 320px;
  align-self: flex-start;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
}
.question__mark {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 28px;
  padding: 0 var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
  background: transparent;
  color: var(--mc-text-muted);
  font: inherit;
  font-size: var(--mc-text-xs);
  cursor: pointer;
}
.question__mark--on {
  border-color: var(--mc-warning-border);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}
@media (min-width: 1024px) {
  .question__mark {
    display: none;
  }
}
@media (max-width: 1023px) {
  .question {
    padding: var(--mc-space-4);
  }

  /* 解析模式题头在窄屏会折成多行，跳题后给卡片留足吸顶空间 */
  .question--revealed {
    scroll-margin-top: 216px;
  }
}
</style>
