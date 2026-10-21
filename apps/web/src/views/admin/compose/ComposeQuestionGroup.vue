<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import ComposeQuestionCard from './ComposeQuestionCard.vue';
import { fmtScore } from '@/composables/use-exam-compose';
import type { ExamCompose, PaperQuestion } from '@/composables/use-exam-compose';
import type { ComposeGroup, ExamPaper } from '@/composables/use-exam-paper';

/** 卷面里的一组题（同一「所属大题」）：组头统计 + 逐题卡片。 */
defineProps<{ group: ComposeGroup; compose: ExamCompose; paper: ExamPaper }>();
const emit = defineEmits<{ view: [question: PaperQuestion]; replace: [id: number] }>();
</script>

<template>
  <div class="stp__group">
    <div class="stp__grouphead">
      <Icon name="list" :size="15" />
      <span class="stp__groupname">{{ group.name }}</span>
      <span class="mc-muted">{{ group.questions.length }} 题 · {{ fmtScore(group.score) }} 分</span>
    </div>
    <ComposeQuestionCard
      v-for="q in group.questions"
      :key="q.id"
      :question="q"
      :compose="compose"
      :paper="paper"
      @view="emit('view', $event)"
      @replace="emit('replace', $event)"
    />
  </div>
</template>

<style scoped>
.stp__group {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.stp__grouphead {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-3);
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius);
}

.stp__groupname {
  font-weight: var(--mc-font-medium);
}
</style>
