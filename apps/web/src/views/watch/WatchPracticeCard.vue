<script setup lang="ts">
/**
 * 观看页侧栏「本课时练习」：教师通过实践关联挂到本课时的题库 / 章节 / 小节 / 单题。
 *
 * 没有关联内容时整块不渲染；全部条目都进现有的课时刷题页（当前唯一的刷题路由
 * `lessons/:id/quiz`，按课时取题）。
 */
import { reactive } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { practiceBankLabel, stemPreview } from '@/utils/practice-link';
import type { useWatchPractice } from '@/composables/use-watch-practice';

const props = defineProps<{
  practice: ReturnType<typeof useWatchPractice>;
  lessonId: number;
}>();

const state = reactive(props.practice);
</script>

<template>
  <section v-if="state.hasAny" class="mc-card practice">
    <header class="mc-card__header practice__head">
      <span class="mc-card__title">本课时练习</span>
      <span class="mc-muted practice__count">{{ state.banks.length + state.questions.length }} 项</span>
    </header>

    <div class="mc-card__body mc-col">
      <ul v-if="state.banks.length > 0" class="practice__list">
        <li v-for="(bank, index) in state.banks" :key="`${bank.bankId}-${bank.chapter}-${bank.section}-${index}`">
          <RouterLink class="practice__item" :to="{ name: 'quiz', params: { id: lessonId } }">
            <Icon name="bank" :size="15" class="practice__icon" />
            <span class="practice__name" :title="practiceBankLabel(bank)">{{ practiceBankLabel(bank) }}</span>
            <Icon name="chevron-right" :size="14" class="practice__arrow" />
          </RouterLink>
        </li>
      </ul>

      <ul v-if="state.questions.length > 0" class="practice__list">
        <li v-for="question in state.questions" :key="question.linkId">
          <RouterLink class="practice__item" :to="{ name: 'quiz', params: { id: lessonId } }">
            <Icon name="pen-line" :size="15" class="practice__icon" />
            <span class="practice__name" :title="question.stem">{{ stemPreview(question.stem) }}</span>
            <Icon name="chevron-right" :size="14" class="practice__arrow" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.practice__head {
  gap: var(--mc-space-2);
}

.practice__count {
  font-size: var(--mc-text-xs);
}

.practice__list {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  max-height: 240px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.practice__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  text-decoration: none;
}

.practice__item:hover {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.practice__icon,
.practice__arrow {
  flex: none;
  color: var(--mc-text-muted);
}

.practice__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
