<script setup lang="ts">
import { reactive } from 'vue';
import QuestionEditor from './QuestionEditor.vue';
import BankFormDialog from './BankFormDialog.vue';
import BankFolderDialog from './BankFolderDialog.vue';
import BankQuickDialogs from './BankQuickDialogs.vue';
import BankDifficultyCalcDialog from './BankDifficultyCalcDialog.vue';
import BankImportResult from './BankImportResult.vue';
import PracticeLinkDialog from './PracticeLinkDialog.vue';
import QuestionSectionsDialog from './QuestionSectionsDialog.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankImport } from '@/composables/use-bank-import';
import type { useBankActions } from '@/composables/use-bank-actions';
import type { usePracticeLinks } from '@/composables/use-practice-links';

/**
 * 题库页弹窗收口（从 BankAdminView 抽出）：
 * 重算难度、清理重复题 / 整卷建考试、题库表单、题目编辑器、导入结果、关联课时、批量章节。
 * 弹窗的开关状态仍在对应组合式函数里，这里只负责按状态挂载并接事件。
 */
const props = defineProps<{
  catalog: ReturnType<typeof useBankCatalog>;
  questions: ReturnType<typeof useQuestionList>;
  actions: ReturnType<typeof useBankActions>;
  imports: ReturnType<typeof useBankImport>;
  practice: ReturnType<typeof usePracticeLinks>;
}>();

const catalogApi = props.catalog;
const questionApi = props.questions;
const actionsApi = props.actions;
const importApi = props.imports;
const practiceApi = props.practice;
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
    :folder-options="catalogState.folderOptions"
    @close="actionsState.bankFormOpen = false"
    @save="actionsState.saveBank"
  />

  <!-- 文件夹新建 / 重命名 -->
  <BankFolderDialog
    :open="catalogState.folderDialogOpen"
    v-model:name="catalogState.folderDialogName"
    :title="catalogState.folderDialogTitle"
    :mode="catalogState.folderDialogMode"
    :parent-name="catalogState.folderDialogParentName"
    :saving="catalogState.folderSaving"
    @close="catalogState.closeFolderDialog"
    @save="catalogState.saveFolder"
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

  <!-- 关联课时：整库 / 章节 / 小节 / 单题四种粒度共用一个弹窗 -->
  <PracticeLinkDialog :links="practiceApi" />

  <!-- 批量设置章节 / 小节 -->
  <QuestionSectionsDialog
    :open="questionsState.sectionsDialogOpen"
    v-model:chapter="questionsState.sectionChapter"
    v-model:section="questionsState.sectionSection"
    :saving="questionsState.sectionsSaving"
    :count="questionsState.selectedCount"
    @close="questionsState.sectionsDialogOpen = false"
    @save="questionsState.saveSections"
  />
</template>
