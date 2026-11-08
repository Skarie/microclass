<script setup lang="ts">
import { reactive } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import BankOverviewHeader from './BankOverviewHeader.vue';
import BankHealthPanel from './BankHealthPanel.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 题库页顶部：PageHeader 操作按钮 + KPI 卡片行 + 题库体检弹窗。
 * 状态来自目录 / 题目列表 / 题库操作三个组合式函数，这里只接上展示与事件。
 */
const props = defineProps<{
  catalog: ReturnType<typeof useBankCatalog>;
  questions: ReturnType<typeof useQuestionList>;
  actions: ReturnType<typeof useBankActions>;
}>();

const catalogApi = props.catalog;
const questionApi = props.questions;
const actionsApi = props.actions;
const catalogState = reactive(catalogApi);
const questionsState = reactive(questionApi);
const actionsState = reactive(actionsApi);
</script>

<template>
  <PageHeader
    title="题库管理"
    description="按文件夹整理题库、按课程查看关联，导入 CSV 或 Markdown 题目，导出 Word/CSV，处理重复题与难度标注。"
    icon="bank"
    :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '题库管理' }]"
  >
    <template #actions>
      <button
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="actionsState.healthLoading"
        @click="actionsState.toggleHealth"
      >
        <Icon name="shield" :size="16" />
        {{ actionsState.healthOpen ? '收起体检' : '题库体检' }}
      </button>
      <button
        class="mc-btn mc-btn--sm"
        type="button"
        :disabled="catalogState.banksLoading"
        @click="catalogState.loadBanks()"
      >
        <Icon name="refresh" :size="16" />
        刷新
      </button>
      <button
        class="mc-btn mc-btn--primary mc-btn--sm"
        type="button"
        @click="actionsState.openCreateBank(catalogState.currentFolderId)"
      >
        <Icon name="plus" :size="16" />
        新建题库
      </button>
    </template>
  </PageHeader>

  <!-- 指标卡片行：先给全局规模感，再进入具体操作（对标学之思/超星的工作台形态） -->
  <BankOverviewHeader
    :binding="catalogState.binding"
    :question-total="actionsState.health ? actionsState.health.stats.total : null"
    :empty-answer="actionsState.health ? actionsState.health.stats.emptyAnswer : null"
    @pick-unbound="catalogState.pickCourse('unbound')"
  />
  <!-- 题库体检：弹窗展示，避免在页面中间插入整块导致布局跳动 -->
  <BankHealthPanel
    v-if="actionsState.health"
    :open="actionsState.healthOpen"
    :health="actionsState.health"
    :loading="actionsState.healthLoading"
    :diff-busy="actionsState.diffBusy"
    @close="actionsState.healthOpen = false"
    @refresh="actionsState.loadHealth()"
    @show-media-only="questionsState.showMediaOnlyQuestions"
    @recalc="actionsState.openDifficulty"
    @calibrate="actionsState.calibrateDifficulty"
  />
</template>
