<script setup lang="ts">
import QuizFlowHeader from './QuizFlowHeader.vue';

/** 课后练习题头：返回课时 + 已答/进度 + 交卷；随机题数在答题卡底部切换 */
defineProps<{
  lessonId: number;
  title: string;
  total: number;
  answered: number;
  unlocked: boolean;
  submitting: boolean;
}>();

const emit = defineEmits<{ submit: [] }>();
</script>

<template>
  <QuizFlowHeader
    :back-to="{ name: 'watch', params: { id: lessonId } }"
    back-label="返回课时"
    :title="`课后练习 · ${title}`"
    :total="total"
    :answered="answered"
    answered-label="已答"
    progress-label="练习进度"
    show-submit
    :submitting="submitting"
    :submit-disabled="submitting || !unlocked"
    @submit="emit('submit')"
  />
</template>
