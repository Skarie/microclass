<script setup lang="ts">
/**
 * 在线考试作答页 = 只做编排（学习通式单题流）：
 *  - 取卷 / 交卷 / 倒计时 / 自动交卷 / 离开确认：composables/use-exam-take.ts
 *  - 固定题头（含倒计时）、单题卡片、底部操作条、右侧答题卡/移动抽屉：views/quiz/*
 * 答案编码与后端一致：单选/多选传选项下标（多选逗号升序），判断传 T/F。
 */
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Tag from '@/components/Tag.vue';
import ExamClock from './exam-take/ExamClock.vue';
import ExamTakeAlready from './exam-take/ExamTakeAlready.vue';
import ExamTakeLoadFail from './exam-take/ExamTakeLoadFail.vue';
import QuizFlowHeader from './quiz/QuizFlowHeader.vue';
import QuizStage from './quiz/QuizStage.vue';
import { useExamTake } from '@/composables/use-exam-take';

const take = useExamTake();

const examTitle = computed(() => take.data?.exam.title ?? '');
const examDescription = computed(
  () => take.data?.exam.description || '提交后立即判分；每场考试只能交卷一次，请确认无误后再提交。',
);
const passScore = computed(() => take.data?.exam.pass_score);
const clock = computed(() => (take.limitSeconds > 0 ? take.formatClock(take.remaining) : '不限时'));
const clockWarn = computed(() => take.limitSeconds > 0 && take.remaining <= 60);
</script>

<template>
  <section v-if="take.loading && !take.data" class="mc-col">
    <div class="mc-skeleton mc-skeleton--h160" />
    <div class="mc-skeleton mc-skeleton--h320" />
  </section>

  <ExamTakeLoadFail v-else-if="!take.data" :loading="take.loading" @retry="take.run()" />

  <ExamTakeAlready v-else-if="take.data.already" :exam-id="take.examId" :title="examTitle" />

  <section v-else class="take mc-col">
    <QuizFlowHeader
      :back-to="{ name: 'hall' }"
      back-label="课程大厅"
      :title="`在线考试 · ${examTitle}`"
      :total="take.questions.length"
      :answered="take.answeredCount"
      answered-label="已答"
      progress-label="考试进度"
      :show-submit="take.questions.length > 0"
      :submitting="take.submitting"
      :submit-disabled="take.submitting"
      @submit="take.submit()"
    >
      <template #badges>
        <ExamClock :clock="clock" :warn="clockWarn" :limited="take.limitSeconds > 0" />
        <Tag v-if="take.questions.length > 0" class="take__count-tag" tone="primary" size="sm" icon="list">
          {{ take.questions.length }} 题
        </Tag>
        <Tag v-if="passScore !== undefined" size="sm" icon="target">及格线 {{ passScore }}%</Tag>
      </template>
    </QuizFlowHeader>

    <p class="mc-hint take__hint">{{ examDescription }}</p>

    <EmptyState
      v-if="take.questions.length === 0"
      icon="bank"
      title="本场考试还没有组卷"
      description="请联系教师完成组卷后再来作答。"
    />

    <QuizStage v-else :flow="take" mode="exam" :show-count="false" />
  </section>
</template>

<style scoped>
.take__hint {
  margin: 0;
}

/* 手机题头只留倒计时/及格线/已答/进度，题量在答题卡里已经能看到 */
@media (max-width: 1023px) {
  .take__count-tag {
    display: none;
  }
}
</style>
