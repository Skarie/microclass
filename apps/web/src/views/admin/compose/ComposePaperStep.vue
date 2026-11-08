<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 大题行由 useExamStructure.sections 持有，增删就地编辑 */
import { ref } from 'vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import ComposeSectionBar from './ComposeSectionBar.vue';
import ComposeQuestionGroup from './ComposeQuestionGroup.vue';
import ComposeDifficultyPanel from './ComposeDifficultyPanel.vue';
import ComposeSettingsPanel from './ComposeSettingsPanel.vue';
import ComposeQuestionViewModal from './ComposeQuestionViewModal.vue';
import { fmtScore } from '@/composables/use-exam-compose';
import type { ExamCompose, PaperQuestion } from '@/composables/use-exam-compose';
import type { ExamPaper } from '@/composables/use-exam-paper';
import type { ExamSettings } from '@/composables/use-exam-settings';
import type { ExamStructure } from '@/composables/use-exam-structure';

/**
 * 第③步「看卷子」：大题编辑行 + 按大题分组的题目卡片 + 难度分布 + 考试设置。
 * 具体改分/换题/排序动作在 useExamPaper，大题结构在 useExamStructure，这里只排界面。
 */
defineProps<{ compose: ExamCompose; paper: ExamPaper; structure: ExamStructure; settings: ExamSettings }>();
const emit = defineEmits<{ pick: []; next: []; replace: [id: number] }>();

const viewQuestion = ref<PaperQuestion | null>(null);
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">
        ③ 卷子内容（{{ compose.paper.length }} 题 · 合计 {{ fmtScore(paper.totalScore) }} 分）
      </span>
      <span class="mc-spacer" />
      <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="emit('pick')">
        <Icon name="plus" :size="16" />
        再加题
      </button>
    </div>
    <div class="mc-card__body mc-col">
      <EmptyState
        v-if="compose.paper.length === 0"
        icon="exam"
        title="还没有题"
        description="回上一步用「随机组卷」或「自己挑题」。"
      />

      <ComposeSectionBar
        v-for="(s, si) in structure.sections"
        :key="`s-${si}`"
        :section="s"
        :index="si"
        :busy="compose.busy"
        @apply="structure.setSectionScore(s.name, $event)"
        @remove="structure.sections.splice(si, 1)"
      />

      <ComposeQuestionGroup
        v-for="g in paper.groups"
        :key="g.name"
        :group="g"
        :compose="compose"
        :paper="paper"
        @view="viewQuestion = $event"
        @replace="emit('replace', $event)"
      />

      <div v-if="compose.paper.length > 0" class="stp__row">
        <button
          class="mc-btn mc-btn--sm"
          type="button"
          @click="structure.sections.push({ name: '', type: '', score: 0, description: '' })"
        >
          <Icon name="plus" :size="16" />
          添加大题
        </button>
        <button class="mc-btn mc-btn--soft mc-btn--sm" type="button" @click="structure.fillSectionsByType">
          <Icon name="sparkles" :size="16" />
          按题型自动生成大题
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="compose.busy" @click="structure.saveStructure">
          保存结构并刷分值
        </button>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--primary" type="button" @click="emit('next')">
          下一步：打印预览
          <Icon name="arrow-right" :size="16" />
        </button>
      </div>

      <ComposeDifficultyPanel :items="paper.difficultyCheck" />
      <ComposeSettingsPanel :setup="settings" />
    </div>

    <ComposeQuestionViewModal :question="viewQuestion" @close="viewQuestion = null" />
  </section>
</template>

<style scoped>
.stp__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
}
</style>
