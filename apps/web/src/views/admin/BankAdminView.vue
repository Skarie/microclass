<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BankAdminHeader from './BankAdminHeader.vue';
import BankSidePanel from './BankSidePanel.vue';
import BankQuestionPanel from './BankQuestionPanel.vue';
import BankPageDialogs from './BankPageDialogs.vue';
import { useBankCatalog, type BankCatalogDeps } from '@/composables/use-bank-catalog';
import { useQuestionList } from '@/composables/use-question-list';
import { useBankImport } from '@/composables/use-bank-import';
import { useBankActions } from '@/composables/use-bank-actions';

/**
 * 本组件只做组合式函数的编排：目录 → 题目列表 → 导入导出 → 题库操作。
 * 业务状态各自落在对应的组合式函数里，跨函数只通过参数/返回值传递（没有全局单例）。
 * 页面骨架分三块：顶部（PageHeader + KPI + 体检）/ 左栏导航与题库列表 / 右栏题目表；
 * 四个组合式函数的返回值整包传给子组件，子组件内部再解包，避免父页面逐项透传。
 */
const catalogDeps: BankCatalogDeps = {
  // 先占位：题目列表创建后立刻回填（loadBanks 只在挂载与用户交互之后才调用）
  loadQuestions: async () => {},
  clearQuestions: () => {},
};
const catalogApi = useBankCatalog(catalogDeps);
/** 两个隐藏的文件输入框：模板 ref 必须由本组件持有，再把 ref 注入相关组合式函数 */
const fileInput = ref<HTMLInputElement | null>(null);
const qImageInput = ref<HTMLInputElement | null>(null);
const questionApi = useQuestionList({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadBanks: catalogApi.loadBanks,
  qImageInput,
});
catalogDeps.loadQuestions = questionApi.loadQuestions;
catalogDeps.clearQuestions = questionApi.clearQuestions;

const importApi = useBankImport({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadQuestions: questionApi.loadQuestions,
  loadBanks: catalogApi.loadBanks,
  page: questionApi.page,
  fileInput,
});
const actionsApi = useBankActions({
  selectedBankId: catalogApi.selectedBankId,
  selectedBank: catalogApi.selectedBank,
  loadBanks: catalogApi.loadBanks,
  loadQuestions: questionApi.loadQuestions,
  loadCatalog: catalogApi.loadCatalog,
  loadBookCatalog: catalogApi.loadBookCatalog,
  downloadTemplate: importApi.downloadTemplate,
  exportBank: importApi.exportBank,
});

/** 文档级快捷键：/ 聚焦题干搜索（在输入框里打字时不拦截） */
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== '/') return;
  const target = event.target as HTMLElement | null;
  const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  if (typing) return;
  event.preventDefault();
  questionApi.keywordInput.value?.focus();
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown);
});

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown);
  questionApi.loadPrefs();
  void actionsApi.loadCourses();
  void catalogApi.loadCatalog();
  // 表单章节候选与「按册次」目录都来自 catalog-sections
  void catalogApi.loadBookCatalog();
  void catalogApi.loadBanks(false);
  // 指标卡片要用体检数据（服务端已预热 + 5 分钟缓存，约 20ms；失败不影响页面）
  void actionsApi.loadHealth(true);
});
</script>

<template>
  <section class="page mc-col">
    <BankAdminHeader :catalog="catalogApi" :questions="questionApi" :actions="actionsApi" />

    <div class="layout">
      <BankSidePanel :catalog="catalogApi" :questions="questionApi" :actions="actionsApi" />
      <BankQuestionPanel :catalog="catalogApi" :questions="questionApi" :actions="actionsApi" :imports="importApi" />
    </div>

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      accept=".csv,.md,.markdown,.txt,.docx,text/csv,text/markdown"
      aria-hidden="true"
      tabindex="-1"
      @change="importApi.onImportFilePicked"
    />
    <input
      ref="qImageInput"
      class="hidden-input"
      type="file"
      accept="image/*"
      aria-hidden="true"
      tabindex="-1"
      @change="questionApi.onQuestionImagePicked"
    />

    <BankPageDialogs :catalog="catalogApi" :questions="questionApi" :actions="actionsApi" :imports="importApi" />
  </section>
</template>

<style scoped src="./bank-admin.css"></style>
