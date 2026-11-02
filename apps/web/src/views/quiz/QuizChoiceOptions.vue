<script setup lang="ts">
import { computed } from 'vue';
import QuizOptionCard from './QuizOptionCard.vue';
import { optionIndices } from '@/utils/quiz';
import type { GradedItem } from '@/api/types';
import type { QuizQuestion } from '@/utils/quiz';
import type { OptionState } from './quiz-types';

/** 单选/多选/判断的大卡片选项：选中态与解析态都在这里计算 */
const props = defineProps<{
  q: QuizQuestion;
  answer: string;
  picked: string[];
  graded: GradedItem | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ pick: [value: string] }>();

const correctIndices = computed(() => optionIndices(props.graded?.answer));
const pickedIndices = computed(() => props.picked.map((v) => Number(v)));

function choiceState(index: number): OptionState {
  const selected = props.q.type === 'multiple' ? pickedIndices.value.includes(index) : props.answer === String(index);
  if (props.graded) {
    if (correctIndices.value.includes(index)) return 'correct';
    return selected ? 'wrong' : 'idle';
  }
  return selected ? 'selected' : 'idle';
}

function judgeState(value: 'T' | 'F'): OptionState {
  const selected = props.answer === value;
  if (props.graded) {
    if (props.graded.answer === value) return 'correct';
    return selected ? 'wrong' : 'idle';
  }
  return selected ? 'selected' : 'idle';
}
</script>

<template>
  <div v-if="q.type === 'single' || q.type === 'multiple'" class="options">
    <QuizOptionCard
      v-for="(opt, oi) in q.options"
      :key="oi"
      :input-type="q.type === 'multiple' ? 'checkbox' : 'radio'"
      :name="`q-${q.id}`"
      :value="String(oi)"
      :marker="String.fromCharCode(65 + oi)"
      :text="opt"
      :checked="q.type === 'multiple' ? picked.includes(String(oi)) : answer === String(oi)"
      :state="choiceState(oi)"
      :disabled="disabled"
      @toggle="emit('pick', $event)"
    />
  </div>

  <div v-else-if="q.type === 'judge'" class="options">
    <QuizOptionCard
      input-type="radio"
      :name="`q-${q.id}`"
      value="T"
      marker="对"
      text="正确"
      :checked="answer === 'T'"
      :state="judgeState('T')"
      :disabled="disabled"
      @toggle="emit('pick', $event)"
    />
    <QuizOptionCard
      input-type="radio"
      :name="`q-${q.id}`"
      value="F"
      marker="错"
      text="错误"
      :checked="answer === 'F'"
      :state="judgeState('F')"
      :disabled="disabled"
      @toggle="emit('pick', $event)"
    />
  </div>
</template>

<style scoped>
.options {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}
</style>
