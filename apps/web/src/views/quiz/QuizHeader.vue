<script setup lang="ts">
import Tag from '@/components/Tag.vue';
import QuizFlowHeader from './QuizFlowHeader.vue';

/** 课后练习题头：在通用单题流题头上补「返回课时」「随机抽题」与交卷 */
defineProps<{
  lessonId: number;
  title: string;
  index: number;
  total: number;
  answered: number;
  unlocked: boolean;
  submitting: boolean;
  randomMode: boolean;
}>();

const emit = defineEmits<{ submit: [] }>();
</script>

<template>
  <QuizFlowHeader
    :back-to="{ name: 'watch', params: { id: lessonId } }"
    back-label="返回课时"
    :title="`课后练习 · ${title}`"
    :index="index"
    :total="total"
    :answered="answered"
    answered-label="已答"
    progress-label="练习进度"
    show-submit
    :submitting="submitting"
    :submit-disabled="submitting || !unlocked"
    @submit="emit('submit')"
  >
    <template #badges>
      <Tag v-if="randomMode" tone="primary" size="sm" icon="sparkles">随机抽题</Tag>
    </template>
  </QuizFlowHeader>
</template>
