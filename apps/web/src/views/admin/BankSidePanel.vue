<script setup lang="ts">
import { reactive } from 'vue';
import CourseBankNav from './CourseBankNav.vue';
import BookBankNav from './BookBankNav.vue';
import BankListPanel from './BankListPanel.vue';
import BankNavViewSwitch from './BankNavViewSwitch.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 左栏题库导航卡片（从 BankAdminView 抽出）：
 * 卡片头 + 题库搜索/类型筛选 + 课程/册次/题库三级导航。
 * 页面层级（browseLevel）由目录组合式函数决定，这里只按层级挂载子组件。
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
</script>

<template>
  <aside class="mc-card bank-panel">
    <div class="mc-card__header">
      <span class="mc-card__title">题库导航</span>
      <span class="mc-muted">{{ catalogState.navCountLabel }}</span>
    </div>

    <!-- 搜索与类型筛选：属于「题库列表」，从课程树里提出来放到显眼位置 -->
    <div class="tree__toolbar">
      <input
        v-model.trim="catalogState.bankKeyword"
        class="mc-input tree__search"
        type="search"
        placeholder="搜题库名（回车或输入即筛）"
        aria-label="搜索题库名"
        @keyup.enter="catalogState.loadBanks(false)"
      />
      <select v-model="catalogState.kindFilter" class="mc-select tree__kind" aria-label="按题库类型筛选">
        <option value="">全部类型</option>
        <option value="lesson">课时配套</option>
        <option value="chapter">章节题库</option>
        <option value="paper">整卷试卷</option>
      </select>
    </div>

    <div class="tree__views">
      <BankNavViewSwitch :model-value="catalogState.navView" @update:model-value="catalogState.switchNavView" />
    </div>

    <BookBankNav
      v-if="
        catalogState.navView === 'book' &&
        (catalogState.browseLevel === 'books' || catalogState.browseLevel === 'sections')
      "
      :catalog="catalogApi"
    />
    <CourseBankNav
      v-else-if="
        catalogState.navView === 'course' &&
        (catalogState.browseLevel === 'courses' || catalogState.browseLevel === 'books')
      "
      :catalog="catalogApi"
      :actions="actionsApi"
    />
    <BankListPanel v-else :catalog="catalogApi" :questions="questionApi" :actions="actionsApi" />
  </aside>
</template>

<style scoped>
/* 左栏导航：头部吸附、行高统一 */
.bank-panel {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 220px);
  padding: 0;
  overflow: hidden;
  position: sticky;
  top: var(--mc-space-5);
}

.bank-panel .mc-card__header {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-3);
  background: var(--mc-bg-elev, var(--mc-surface-2));
  border-bottom: 1px solid var(--mc-border);
}

.bank-panel .tree__toolbar {
  padding: var(--mc-space-3) var(--mc-space-4) var(--mc-space-2);
  margin: 0;
}

.tree__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
  padding-bottom: var(--mc-space-2);
}

.tree__search {
  /* 占满一整行：左栏窄，搜索框和类型下拉并排会把两边都挤到看不清 */
  flex: 1 1 100%;
  min-width: 0;
}

.tree__kind {
  flex: 1 1 120px;
  max-width: 100%;
}

.tree__views {
  padding: 0 var(--mc-space-4) var(--mc-space-2);
}

@media (max-width: 1080px) {
  .bank-panel {
    position: static;
  }
}
</style>
