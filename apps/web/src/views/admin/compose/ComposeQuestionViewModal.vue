<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import RichText from '@/components/RichText.vue';
import type { PaperQuestion } from '@/composables/use-exam-compose';

/** 「放大看」弹窗：题干、选项、答案与解析。 */
defineProps<{ question: PaperQuestion | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <AppModal :open="question !== null" title="查看题目" width="760px" @close="emit('close')">
    <div v-if="question" class="mc-col">
      <RichText :text="question.stem" />
      <ul v-if="question.options.length > 0" class="stp__opts">
        <li v-for="(opt, oi) in question.options" :key="oi">
          <span class="stp__optlabel">{{ String.fromCharCode(65 + oi) }}.</span>
          <RichText inline :text="opt" />
        </li>
      </ul>
      <p><strong>答案：</strong>{{ question.answer || '（未录入）' }}</p>
      <p v-if="question.analysis"><strong>解析：</strong><RichText inline :text="question.analysis" /></p>
    </div>
  </AppModal>
</template>

<style scoped>
.stp__opts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stp__optlabel {
  margin-right: 4px;
  color: var(--mc-text-muted);
}
</style>
