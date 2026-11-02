<script setup lang="ts">
import { computed } from 'vue';
import AnswerText from '@/components/AnswerText.vue';
import RichText from '@/components/RichText.vue';
import type { GradedItem, QuestionView } from '@/api/types';
import { judgeText, lettersOf } from '@/utils/quiz';

/** 解析区：你的作答 / 正确答案 / 解析（沿用后端逐题 graded 结构） */
const props = defineProps<{
  q: QuestionView;
  graded: GradedItem;
}>();

const isChoice = computed(() => props.q.type === 'single' || props.q.type === 'multiple');

function choiceText(raw: string | undefined): string {
  if (!raw) return '';
  const letters = lettersOf(raw);
  return letters ? `${letters}（${raw}）` : raw;
}

const given = computed(() => {
  const raw = props.graded.given;
  if (isChoice.value) return choiceText(raw);
  if (props.q.type === 'judge') return judgeText(raw);
  return raw;
});

const answerLetters = computed(() => choiceText(props.graded.answer));
const answerJudge = computed(() => judgeText(props.graded.answer));
</script>

<template>
  <div class="review">
    <div class="review__row">
      <span class="review__label">你的作答：</span>
      <span v-if="isChoice" :class="graded.correct === false ? 'review__bad' : 'review__mono'">
        {{ given || '（未作答）' }}
      </span>
      <span v-else-if="q.type === 'judge'" :class="graded.correct === false ? 'review__bad' : 'review__mono'">
        {{ given || '（未作答）' }}
      </span>
      <span v-else class="review__mono">{{ given || '（未作答）' }}</span>
    </div>

    <div class="review__row">
      <span class="review__label">参考答案：</span>
      <span class="review__correct">
        <template v-if="isChoice">{{ answerLetters }}</template>
        <template v-else-if="q.type === 'judge'">{{ answerJudge }}</template>
        <template v-else>
          <AnswerText :answer="graded.answer" :type="q.type" />
        </template>
      </span>
    </div>

    <div v-if="graded.analysis" class="review__row review__analysis">
      <span class="review__label">解析：</span>
      <RichText inline :text="graded.analysis" />
    </div>
  </div>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-sm);
}

.review__row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--mc-space-2);
  line-height: var(--mc-leading);
}

.review__label {
  color: var(--mc-text-muted);
}

.review__mono {
  font-family: var(--mc-font-mono);
  word-break: break-word;
}

.review__bad {
  color: var(--mc-danger-fg);
}

.review__correct {
  color: var(--mc-success-fg);
  font-weight: var(--mc-font-semibold);
}

.review__analysis {
  color: var(--mc-text-secondary);
}
</style>
