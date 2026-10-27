<script setup lang="ts">
import { reactive } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import BankNavCrumbs from './BankNavCrumbs.vue';
import { KIND_LABEL } from '@/composables/use-bank-catalog';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 左栏题库列表（从 BankAdminView 抽出）：
 * 面包屑、排序、加载骨架、空态、题库行（选中态 / 行内菜单 / 挂到课程）、展开全部。
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
  <!-- 三级：题库列表（搜索结果 / 某课程 / 某册次），带面包屑可返回 -->
  <div class="bank-panel__list">
    <BankNavCrumbs
      :label="catalogState.crumbPath"
      :back-label="catalogState.crumbBackLabel"
      @back="catalogState.backFromBanks"
    />
    <div class="mc-row bank-panel__listhead">
      <span class="mc-muted">题库</span>
      <div class="mc-spacer" />
      <select v-model="catalogState.bankSort" class="mc-select bank-panel__sort" aria-label="题库排序">
        <option value="default">最新创建</option>
        <option value="questions">题量最多</option>
        <option value="name">按名称</option>
      </select>
    </div>

    <div v-if="catalogState.banksLoading && catalogState.banks.length === 0" class="bank-panel__loading">
      <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="catalogState.banks.length === 0"
      icon="bank"
      title="这个范围里还没有题库"
      description="换个课程/章节看看，或直接新建题库。"
      action-text="新建题库"
      @action="actionsState.openCreateBank"
    />

    <ul v-else class="bank-list">
      <li
        v-for="bank in catalogState.visibleBanks"
        :key="bank.id"
        class="bank-item"
        :class="{ 'bank-item--active': bank.id === catalogState.selectedBankId }"
        @click="questionsState.selectBank(bank)"
      >
        <div class="bank-item__main">
          <span class="bank-item__name" :title="bank.name">{{ bank.name }}</span>
          <span class="mc-muted bank-item__meta">
            {{ KIND_LABEL[bank.kind ?? ''] ?? '' }} · {{ bank.question_count }} 题
          </span>
        </div>
        <!-- 行内只留一个「⋯」：原来常显 3 个按钮（重命名/删除等），又挤又容易误点删除 -->
        <div class="bank-item__actions">
          <select
            v-if="catalogState.onlyUnbound"
            class="mc-select bank-item__bind"
            aria-label="挂到课程"
            @click.stop
            @change="catalogState.bindBankCourse(bank, Number(($event.target as HTMLSelectElement).value) || null)"
          >
            <option value="">挂到课程…</option>
            <option v-for="course in catalogState.catalog.courses" :key="course.id" :value="course.id">
              {{ course.name }}
            </option>
          </select>
          <DropdownMenu
            :items="actionsState.bankRowMenuItems()"
            label=""
            icon="more"
            :show-caret="false"
            aria-label="题库操作（重命名 / 删除）"
            variant="ghost"
            @select="(key) => actionsState.onBankRowMenu(bank, key)"
          />
        </div>
      </li>
    </ul>

    <button
      v-if="!catalogState.showAllBanks && catalogState.banks.length > catalogState.visibleBanks.length"
      class="mc-btn mc-btn--ghost mc-btn--sm bank-panel__more"
      type="button"
      @click="catalogState.showAllBanks = true"
    >
      显示全部 {{ catalogState.sortedBanks.length }} 个（当前只显示前 {{ catalogState.visibleBanks.length }} 个）
    </button>
  </div>
</template>

<style scoped src="./bank-list-panel.css"></style>
