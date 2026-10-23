<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import ExamTakeHeader from './ExamTakeHeader.vue';

/** 已交卷状态：不能重复作答，给出成绩页与大厅入口。 */
defineProps<{ examId: number; title: string }>();
</script>

<template>
  <section class="take mc-col">
    <ExamTakeHeader :title="title" description="本场考试你已经交卷，不能重复作答。可以进入成绩页复盘每一道题。" />

    <div class="notice mc-card">
      <Icon name="info" :size="15" /> 每场考试只能作答一次，成绩已记录。请前往成绩页查看得分与解析。
    </div>

    <div class="mc-row mc-row--wrap">
      <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'exam-result', params: { id: examId } }">
        查看考试成绩
      </RouterLink>
      <RouterLink class="mc-btn" :to="{ name: 'hall' }">返回课程大厅</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.notice {
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  border-color: transparent;
  font-size: var(--mc-text-sm);
}
</style>
