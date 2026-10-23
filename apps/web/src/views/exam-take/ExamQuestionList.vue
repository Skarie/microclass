<script setup lang="ts">
import ExamQuestionItem from './ExamQuestionItem.vue';
import type { useExamTake } from '@/composables/use-exam-take';

/** 题目列表：只负责有序列表容器，单题渲染与输入事件在 ExamQuestionItem。 */
defineProps<{ take: ReturnType<typeof useExamTake> }>();
const emit = defineEmits<{
  answer: [qid: number, value: string];
  toggle: [qid: number, value: string];
}>();

function forwardAnswer(qid: number, value: string): void {
  emit('answer', qid, value);
}

function forwardToggle(qid: number, value: string): void {
  emit('toggle', qid, value);
}
</script>

<template>
  <ol class="qlist">
    <ExamQuestionItem
      v-for="(q, index) in take.questions"
      :key="q.id"
      :q="q"
      :index="index"
      :take="take"
      @answer="forwardAnswer"
      @toggle="forwardToggle"
    />
  </ol>
</template>

<style scoped>
.qlist {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}
</style>
