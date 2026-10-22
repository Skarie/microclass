<script setup lang="ts">
import { reactive } from 'vue';
import type { useQuestionList } from '@/composables/use-question-list';

/**
 * 右栏分页条（从 BankAdminView 抽出）：
 * 总数/页码、每页条数、首页/上一页/下一页/末页。
 */
const props = defineProps<{
  questions: ReturnType<typeof useQuestionList>;
}>();

const questionApi = props.questions;
const questionsState = reactive(questionApi);
</script>

<template>
  <div class="pager">
    <span class="mc-muted"
      >共 {{ questionsState.total }} 题 · 第 {{ questionsState.page }} / {{ questionsState.totalPages }} 页</span
    >
    <label class="pager__size">
      <span class="mc-muted">每页</span>
      <select
        v-model.number="questionsState.pageSize"
        class="mc-select"
        aria-label="每页条数"
        @change="questionsState.changePageSize"
      >
        <option :value="20">20</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
    </label>
    <div class="mc-spacer" />
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      :disabled="questionsState.page <= 1"
      @click="questionsState.goPageTo(1)"
    >
      首页
    </button>
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      :disabled="questionsState.page <= 1"
      @click="questionsState.goPage(-1)"
    >
      上一页
    </button>
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      :disabled="questionsState.page >= questionsState.totalPages"
      @click="questionsState.goPage(1)"
    >
      下一页
    </button>
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      :disabled="questionsState.page >= questionsState.totalPages"
      @click="questionsState.goPageTo(questionsState.totalPages)"
    >
      末页
    </button>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
}

.pager__size {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-sm);
}
</style>
