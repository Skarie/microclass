<script setup lang="ts">
import BlueprintComposeModal from '@/components/BlueprintComposeModal.vue';
import ReplaceQuestionModal from '@/components/ReplaceQuestionModal.vue';
import type { ExamCompose } from '@/composables/use-exam-compose';

/** 组卷页两个独立弹窗（双向细目表配题、换一题），页面只负责开关与刷新。 */
defineProps<{
  compose: ExamCompose;
  blueprintOpen: boolean;
  replaceOpen: boolean;
  replaceQuestionId: number | null;
}>();
const emit = defineEmits<{
  closeBlueprint: [];
  composed: [];
  closeReplace: [];
  replaced: [];
}>();
</script>

<template>
  <BlueprintComposeModal
    :open="blueprintOpen"
    :exam-id="compose.examId"
    scope="course"
    :busy="compose.busy"
    @close="emit('closeBlueprint')"
    @composed="emit('composed')"
  />
  <ReplaceQuestionModal
    :open="replaceOpen"
    :exam-id="compose.examId"
    :question-id="replaceQuestionId"
    :busy="compose.busy"
    @close="emit('closeReplace')"
    @replaced="emit('replaced')"
  />
</template>
