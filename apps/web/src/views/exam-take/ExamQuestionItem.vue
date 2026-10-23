<script setup lang="ts">
import { computed } from 'vue';
import RichText from '@/components/RichText.vue';
import type { ExamQuestion, useExamTake } from '@/composables/use-exam-take';

/**
 * 一道作答题目：题干 / 配图 / 单选、多选、判断、填空、简答。
 * 作答状态与答案编码都在 use-exam-take（use-exam-answers）；这里只渲染，
 * 输入通过 answer / toggle 事件交回页面，避免直接改写 prop。
 */
const props = defineProps<{
  q: ExamQuestion;
  index: number;
  take: ReturnType<typeof useExamTake>;
}>();
const emit = defineEmits<{
  answer: [qid: number, value: string];
  toggle: [qid: number, value: string];
}>();

const answer = computed({
  get: () => props.take.answers[props.q.id] ?? '',
  set: (value: string) => emit('answer', props.q.id, value),
});
</script>

<template>
  <li :id="`exam-q-${q.id}`" class="question mc-card" :class="{ 'question--done': take.answeredIds.has(q.id) }">
    <div class="question__head">
      <span class="question__index">{{ index + 1 }}</span>
      <span class="mc-badge">{{ take.typeLabel[q.type] }}</span>
      <RichText class="question__stem" :text="q.stem" />
    </div>

    <img
      v-if="take.legacyImageUrl(q)"
      class="question__image"
      :src="take.legacyImageUrl(q)"
      :alt="`第 ${index + 1} 题配图`"
      loading="lazy"
    />

    <div v-if="q.type === 'single' || q.type === 'multiple'" class="options">
      <label
        v-for="(opt, oi) in q.options"
        :key="oi"
        class="option"
        :class="{
          'option--picked': q.type === 'multiple' ? take.isPicked(q.id, String(oi)) : take.answers[q.id] === String(oi),
        }"
      >
        <input v-if="q.type === 'single'" v-model="answer" type="radio" :name="`q-${q.id}`" :value="String(oi)" />
        <input
          v-else
          type="checkbox"
          :checked="take.isPicked(q.id, String(oi))"
          @change="emit('toggle', q.id, String(oi))"
        />
        <span class="option__label">{{ take.optionLabel(oi) }}</span>
        <RichText class="option__text" inline :text="opt" />
      </label>
    </div>

    <div v-else-if="q.type === 'judge'" class="options options--inline">
      <label class="option" :class="{ 'option--picked': take.answers[q.id] === 'T' }">
        <input v-model="answer" type="radio" :name="`q-${q.id}`" value="T" />
        <span class="option__text">对</span>
      </label>
      <label class="option" :class="{ 'option--picked': take.answers[q.id] === 'F' }">
        <input v-model="answer" type="radio" :name="`q-${q.id}`" value="F" />
        <span class="option__text">错</span>
      </label>
    </div>

    <input
      v-else-if="q.type === 'fill'"
      v-model="answer"
      class="mc-input question__fill"
      :aria-label="`第 ${index + 1} 题答案`"
      :placeholder="take.fillPlaceholder(q.blanks)"
    />

    <textarea
      v-else
      v-model="answer"
      class="mc-textarea"
      :aria-label="`第 ${index + 1} 题作答`"
      placeholder="请作答（简答题不自动判分，交卷后可对照参考答案）"
    />
  </li>
</template>

<style scoped>
.question {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
  scroll-margin-top: var(--mc-space-6);
}

.question--done {
  border-color: var(--mc-border-strong);
}

.question__head {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
}

.question__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-bold);
}

.question__stem {
  flex: 1;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-medium);
  white-space: pre-wrap;
}

.question__image {
  max-width: 100%;
  max-height: 320px;
  align-self: flex-start;
  border-radius: var(--mc-radius);
  border: 1px solid var(--mc-border);
}

.options {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.options--inline {
  flex-direction: row;
  gap: var(--mc-space-5);
}

.option {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition);
}

.option:hover {
  background: var(--mc-bg-hover);
}

.option--picked {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.option__label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
}

.option__text {
  font-size: var(--mc-text-base);
}

.question__fill {
  max-width: 460px;
}
</style>
