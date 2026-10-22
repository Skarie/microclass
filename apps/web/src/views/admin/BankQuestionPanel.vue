<script setup lang="ts">
import { reactive } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import QuestionFilters from './QuestionFilters.vue';
import QuestionTable from './QuestionTable.vue';
import QuestionPager from './QuestionPager.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankImport } from '@/composables/use-bank-import';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 右栏题库面板（从 BankAdminView 抽出）：
 * 题库头部（标题/题量/导出/导入/新建）、筛选条、批量条、空态/骨架、题目表格与分页。
 */
const props = defineProps<{
  catalog: ReturnType<typeof useBankCatalog>;
  questions: ReturnType<typeof useQuestionList>;
  actions: ReturnType<typeof useBankActions>;
  imports: ReturnType<typeof useBankImport>;
}>();

const catalogApi = props.catalog;
const questionApi = props.questions;
const actionsApi = props.actions;
const importApi = props.imports;
const catalogState = reactive(catalogApi);
const questionsState = reactive(questionApi);
const actionsState = reactive(actionsApi);
const importsState = reactive(importApi);
</script>

<template>
  <section class="mc-card question-panel">
    <!-- 题库头部：标题单行截断 + 右侧操作区固定（标题很长时不会把按钮挤到下一行） -->
    <div class="mc-card__header bank-head">
      <div class="bank-head__title">
        <span class="bank-head__name mc-truncate">{{
          catalogState.selectedBank ? catalogState.selectedBank.name : '请选择题库'
        }}</span>
        <span v-if="catalogState.selectedBank" class="bank-head__count mc-muted">共 {{ questionsState.total }} 题</span>
      </div>
      <div class="bank-head__actions">
        <DropdownMenu
          :items="actionsState.bankMenuItems"
          label="导出 / 更多"
          :icon="null"
          variant="ghost"
          @select="actionsState.onBankMenuSelect"
        />
        <button
          class="mc-btn mc-btn--soft mc-btn--sm"
          type="button"
          :disabled="importsState.importing || !catalogState.selectedBank"
          @click="importsState.pickImportFile"
        >
          <Icon name="upload" :size="15" />
          {{ importsState.importing ? '导入中…' : '导入题目' }}
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="!catalogState.selectedBank"
          @click="questionsState.openCreateQuestion"
        >
          <Icon name="plus" :size="15" />
          新建题目
        </button>
      </div>
    </div>

    <div class="mc-card__body mc-col">
      <QuestionFilters :questions="questionApi" />

      <!-- 选中后出现的批量操作条：不再需要一条条点 -->
      <div v-if="questionsState.selectedCount > 0" class="bulk-bar">
        <span class="bulk-bar__count">已选 {{ questionsState.selectedCount }} 题</span>
        <div class="mc-spacer" />
        <DropdownMenu
          :items="questionsState.bulkDifficultyItems"
          label="批量改难度"
          :icon="null"
          variant="soft"
          :disabled="questionsState.bulkBusy"
          @select="(key) => questionsState.bulkSetDifficulty(key as 'easy' | 'medium' | 'hard')"
        />
        <button
          class="mc-btn mc-btn--sm mc-btn--danger"
          type="button"
          :disabled="questionsState.bulkBusy"
          @click="questionsState.bulkDelete"
        >
          批量删除
        </button>
        <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="questionsState.clearSelection">
          取消选择
        </button>
      </div>

      <EmptyState
        v-if="!catalogState.selectedBank"
        icon="arrow-left"
        title="请先在左侧选择题库"
        description="选中题库后即可查看、编辑其中的题目，并导入导出 CSV。"
      />

      <div v-else-if="questionsState.questionsLoading && questionsState.questions.length === 0" class="loading">
        <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="questionsState.questions.length === 0"
        icon="info"
        title="没有匹配的题目"
        description="可以调整筛选条件，或新建一道题目；也可以用 CSV 批量导入。"
        action-text="新建题目"
        @action="questionsState.openCreateQuestion"
      />

      <template v-else>
        <QuestionTable :questions="questionApi" />
        <QuestionPager :questions="questionApi" />
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 右栏：题库头部 + 工具条 + 表格 */
.question-panel {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.question-panel .mc-card__header {
  gap: var(--mc-space-3);
  padding: var(--mc-space-4) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
}

.bank-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
  flex-wrap: wrap;
}

.bank-head__title {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-3);
  min-width: 0;
  flex: 1 1 260px;
}

.bank-head__name {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  min-width: 0;
}

.bank-head__count {
  font-size: var(--mc-text-sm);
  white-space: nowrap;
}

.bank-head__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: nowrap;
}

.question-panel .mc-card__body {
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-5);
  gap: var(--mc-space-4);
}

/* 批量操作条：选中后从筛选行下方滑出（用背景色区分"操作态"） */
.bulk-bar {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
}

.bulk-bar__count {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  color: var(--mc-primary-fg);
}
</style>
