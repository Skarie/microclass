<script setup lang="ts">
import { reactive } from 'vue';
import BankFolderNav from './BankFolderNav.vue';
import BankCourseNav from './BankCourseNav.vue';
import BankNavViewSwitch from './BankNavViewSwitch.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';

/**
 * 左栏题库导航（从 BankAdminView 抽出）：
 * 卡片头 + 题库搜索/类型筛选 + 「题库 / 课程关联」分段控件 + 文件夹树 / 课程列表。
 * 题库列表是它右侧的独立卡片（BankListPanel），不在这里重复渲染。
 */
const props = defineProps<{ catalog: ReturnType<typeof useBankCatalog> }>();

const catalogApi = props.catalog;
const catalogState = reactive(catalogApi);
</script>

<template>
  <aside class="mc-card bank-panel">
    <div class="mc-card__header">
      <span class="mc-card__title">题库导航</span>
      <span class="mc-muted bank-panel__count">{{ catalogState.navCountLabel }}</span>
    </div>

    <!-- 搜索与类型筛选：属于「题库列表」，放在导航顶部两个视图共用 -->
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

    <BankFolderNav v-if="catalogState.navView === 'folder'" :catalog="catalogApi" />
    <BankCourseNav v-else :catalog="catalogApi" />
  </aside>
</template>

<style scoped>
/* 左栏导航：头部吸附、行高统一；树/课程列表在内部滚动 */
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
  flex: none;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4) var(--mc-space-5) var(--mc-space-3);
  border-bottom: 1px solid var(--mc-border);
}

.bank-panel__count {
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
}

.bank-panel .tree__toolbar {
  flex: none;
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
  flex: none;
  padding: 0 var(--mc-space-4) var(--mc-space-2);
}

@media (max-width: 1180px) {
  .bank-panel {
    position: static;
    max-height: none;
  }
}
</style>
