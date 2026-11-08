<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import QuizHeader from './quiz/QuizHeader.vue';
import QuizResultHeader from './quiz/QuizResultHeader.vue';
import QuizStage from './quiz/QuizStage.vue';
import { useQuizSession } from '@/composables/use-quiz-session';

/**
 * 课后练习 = 只做编排：题头（练习/结果）、未解锁提示、空状态、刷题主区。
 * 取题/作答/标记/提交/结果统计在 use-quiz-session；
 * 单题、操作条、答题卡与键盘交互在 ./quiz/*。
 */
const session = useQuizSession();
</script>

<template>
  <section v-if="session.loading && session.questions.length === 0" class="mc-col">
    <div class="mc-skeleton mc-skeleton--h160" />
    <div class="mc-skeleton mc-skeleton--h320" />
  </section>

  <EmptyState v-else-if="!session.data" icon="pen-line" title="无法加载练习" description="课时可能已被删除。" />

  <section v-else class="quiz">
    <QuizResultHeader
      v-if="session.result"
      :lesson-id="session.lessonId"
      :title="session.lesson?.title ?? ''"
      :result="session.result"
      :summary="session.summary"
      @retry="session.retry(session.count)"
    />
    <QuizHeader
      v-else
      :lesson-id="session.lessonId"
      :title="session.lesson?.title ?? ''"
      :total="session.questions.length"
      :answered="session.answeredCount"
      :unlocked="session.unlocked"
      :submitting="session.submitting"
      @submit="session.submit"
    />

    <div v-if="!session.unlocked" class="notice mc-card">
      <Icon name="shield" :size="16" /> 该课时尚未解锁练习（本地视频需看完 80%）。请先完整观看视频后再来作答。
    </div>

    <EmptyState
      v-if="session.questions.length === 0"
      icon="bank"
      title="本课时还没有配套题目"
      description="教师可在「题库管理」中创建题目并关联到该课时。"
    />
    <QuizStage v-else :flow="session" />
  </section>
</template>

<style scoped>
.quiz {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3) var(--mc-space-4);
  border-color: transparent;
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  font-size: var(--mc-text-sm);
}
</style>
