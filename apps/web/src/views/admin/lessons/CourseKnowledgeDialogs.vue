<script setup lang="ts">
import CourseKnowledgeDialog from './CourseKnowledgeDialog.vue';
import KnowledgeImportWizard from './KnowledgeImportWizard.vue';
import type { KnowledgePayload } from '@/api/knowledge';
import type { useCourseKnowledge } from '@/composables/use-course-knowledge';
import type { useKnowledgeImport } from '@/composables/use-knowledge-import';

/**
 * 课程知识点的两个弹窗：新增/编辑对话框 + 批量导入向导。
 * 打开状态、请求与刷新都在各自的 composable 里，这里只做收口。
 */
const props = defineProps<{
  knowledge: ReturnType<typeof useCourseKnowledge>;
  importer: ReturnType<typeof useKnowledgeImport>;
}>();

function closeDialog(): void {
  props.knowledge.closeDialog();
}

function submit(payload: KnowledgePayload): void {
  void props.knowledge.save(payload);
}
</script>

<template>
  <CourseKnowledgeDialog
    :open="knowledge.dialogOpen"
    :item="knowledge.editing"
    :saving="knowledge.saving"
    @close="closeDialog"
    @submit="submit"
  />
  <KnowledgeImportWizard :importer="importer" />
</template>
