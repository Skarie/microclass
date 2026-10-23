<script setup lang="ts">
/**
 * 在线考试作答页 = 只做编排：
 *  - 取卷 / 交卷 / 答题进度 / 倒计时 / 自动交卷 / 离开确认：composables/use-exam-take.ts
 *    （倒计时在 use-exam-countdown，答案编码与题型文案在 use-exam-answers）
 *  - 界面按区块拆到 ./exam-take/*：页头、状态条、题目列表与单题、底部答题卡、已交卷、加载失败。
 * 答案编码与后端一致：单选/多选传选项下标（多选逗号升序），判断传 T/F。
 */
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import ExamTakeHeader from './exam-take/ExamTakeHeader.vue';
import ExamTakeStatus from './exam-take/ExamTakeStatus.vue';
import ExamQuestionList from './exam-take/ExamQuestionList.vue';
import ExamTakeFooter from './exam-take/ExamTakeFooter.vue';
import ExamTakeAlready from './exam-take/ExamTakeAlready.vue';
import ExamTakeLoadFail from './exam-take/ExamTakeLoadFail.vue';
import { useExamTake } from '@/composables/use-exam-take';

const take = useExamTake();

const examTitle = computed(() => take.data?.exam.title ?? '');
const examDescription = computed(
  () => take.data?.exam.description || '提交后立即判分；每场考试只能交卷一次，请确认无误后再提交。',
);
const passScore = computed(() => take.data?.exam.pass_score);
const clock = computed(() => (take.limitSeconds > 0 ? take.formatClock(take.remaining) : '不限时'));
const clockWarn = computed(() => take.limitSeconds > 0 && take.remaining <= 60);

/** 子组件只发事件，由页面统一写入作答状态（避免在子组件里改 prop） */
function setAnswer(qid: number, value: string): void {
  take.answers[qid] = value;
}

function toggleAnswer(qid: number, value: string): void {
  take.toggleMultiple(qid, value);
}
</script>

<template>
  <section v-if="take.loading && !take.data" class="mc-col">
    <div class="mc-skeleton mc-skeleton--h160" />
    <div class="mc-skeleton" style="height: 320px" />
  </section>

  <ExamTakeLoadFail v-else-if="!take.data" :loading="take.loading" @retry="take.run()" />

  <ExamTakeAlready v-else-if="take.data.already" :exam-id="take.examId" :title="examTitle" />

  <section v-else class="take mc-col">
    <ExamTakeHeader :title="examTitle" :description="examDescription" />

    <ExamTakeStatus :count="take.questions.length" :pass-score="passScore" :clock="clock" :warn="clockWarn" />

    <EmptyState
      v-if="take.questions.length === 0"
      icon="bank"
      title="本场考试还没有组卷"
      description="请联系教师完成组卷后再来作答。"
    />

    <template v-else>
      <ExamQuestionList :take="take" @answer="setAnswer" @toggle="toggleAnswer" />
      <ExamTakeFooter :take="take" />
    </template>
  </section>
</template>
