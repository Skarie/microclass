<script setup lang="ts">
import { reactive } from 'vue';
import QuestionEditor from './QuestionEditor.vue';
import BankFormDialog from './BankFormDialog.vue';
import BankQuickDialogs from './BankQuickDialogs.vue';
import BankDifficultyCalcDialog from './BankDifficultyCalcDialog.vue';
import BankBackfillDialog from './BankBackfillDialog.vue';
import BankImportResult from './BankImportResult.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankImport } from '@/composables/use-bank-import';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 题库页弹窗收口（从 BankAdminView 抽出）：
 * 重算难度、清理重复题 / 整卷建考试、题库表单、题目编辑器、导入结果。
 * 弹窗的开关状态仍在对应组合式函数里，这里只负责按状态挂载并接事件。
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
  <!-- 重算难度（先预览再执行） -->
  <BankDifficultyCalcDialog
    :open="actionsState.diffOpen"
    :busy="actionsState.diffBusy"
    :scope-all="actionsState.diffScopeAll"
    :bank-name="catalogState.selectedBank?.name ?? ''"
    :preview="actionsState.diffPreview"
    @close="actionsState.diffOpen = false"
    @apply="actionsState.applyDifficulty"
    @toggle-scope="
      actionsState.diffScopeAll = !actionsState.diffScopeAll;
      actionsState.loadDifficultyPreview();
    "
  />

  <!-- 清理重复题 / 整卷建考试 两个弹窗 -->
  <BankQuickDialogs
    :dedupe-open="actionsState.dedupeResult !== null"
    :dedupe="actionsState.dedupeResult"
    :dedupe-busy="actionsState.dedupeBusy"
    :exam-open="actionsState.examOpen"
    :exam-saving="actionsState.examSaving"
    :exam-form="actionsState.examForm"
    :courses="actionsState.courses"
    :bank-name="catalogState.selectedBank?.name ?? ''"
    :bank-question-count="catalogState.selectedBank?.question_count ?? 0"
    @close-dedupe="actionsState.dedupeResult = null"
    @apply-dedupe="actionsState.applyDedupe"
    @close-exam="actionsState.examOpen = false"
    @create-exam="actionsState.createExamFromBank"
  />

  <!-- 题库表单 -->
  <BankFormDialog
    :open="actionsState.bankFormOpen"
    :editing-id="actionsState.bankEditingId"
    :saving="actionsState.bankSaving"
    :form="actionsState.bankForm"
    :lesson-options="catalogState.courseLessonOptions"
    :book-options="catalogState.bookOptions"
    :section-options="catalogState.sectionOptions"
    :catalog-course-id="catalogState.catalogCourseId"
    @close="actionsState.bankFormOpen = false"
    @save="actionsState.saveBank"
  />

  <!-- 批量回填章节（dryRun 预览 → 确认执行） -->
  <BankBackfillDialog
    :open="catalogState.backfillOpen"
    :busy="catalogState.backfillBusy"
    :preview="catalogState.backfillPreview"
    @close="catalogState.closeBackfill"
    @confirm="catalogState.applyBackfill"
  />

  <!-- 题目编辑器 -->
  <QuestionEditor
    :open="questionsState.qOpen"
    :editing-id="questionsState.qEditingId"
    :saving="questionsState.qSaving"
    :image-path="questionsState.qImagePath"
    :current-question="questionsState.questions.find((q) => q.id === questionsState.qEditingId) ?? null"
    :form="questionsState.qForm"
    @close="questionsState.qOpen = false"
    @save="questionsState.saveQuestion"
    @pick-image="questionsState.pickQuestionImage"
  />

  <!-- 导入结果 -->
  <BankImportResult
    :open="importsState.importResult !== null"
    :result="importsState.importResult"
    @close="importsState.importResult = null"
  />
</template>
