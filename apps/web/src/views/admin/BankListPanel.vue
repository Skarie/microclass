<script setup lang="ts">
import { reactive, watch } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import BankNavCrumbs from './BankNavCrumbs.vue';
import { KIND_LABEL, bankCourseName, bankFolderPath, bankLessonTitle } from './bankTypes';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankActions } from '@/composables/use-bank-actions';
import type { usePracticeLinks } from '@/composables/use-practice-links';

/**
 * 中间栏题库列表：当前文件夹 / 课程下的题库行。
 * 关联课程的题库在名称旁显示「已关联 · 课程名」徽标；未关联不显示。
 * 行内「⋯」菜单除了重命名/删除，还可以把整个题库关联到多个课时。
 */
const props = defineProps<{
  catalog: ReturnType<typeof useBankCatalog>;
  questions: ReturnType<typeof useQuestionList>;
  actions: ReturnType<typeof useBankActions>;
  practice: ReturnType<typeof usePracticeLinks>;
}>();

const catalogApi = props.catalog;
const questionApi = props.questions;
const actionsApi = props.actions;
const practiceApi = props.practice;
const catalogState = reactive(catalogApi);
const questionsState = reactive(questionApi);
const actionsState = reactive(actionsApi);
const practiceState = reactive(practiceApi);

/** 只给当前屏上可见的题库行拉关联标记：缓存 + 并发限制在组合式函数里 */
watch(
  () => catalogState.visibleBanks.map((bank) => bank.id),
  (ids) => {
    void practiceState.ensureBankLinks(ids);
  },
  { immediate: true },
);
</script>

<template>
  <section class="mc-card bank-list-panel">
    <div class="mc-card__header bank-list-panel__head">
      <span class="mc-card__title">题库列表</span>
      <span class="mc-muted bank-list-panel__count">
        {{ catalogState.banksLoading ? '加载中…' : `共 ${catalogState.banksTotal} 个` }}
      </span>
    </div>

    <div class="bank-list-panel__body">
      <BankNavCrumbs
        v-if="catalogState.crumbPath !== ''"
        :label="catalogState.crumbPath"
        :back-label="catalogState.crumbBackLabel"
        @back="catalogState.backFromBanks"
      />
      <div class="mc-row bank-list-panel__listhead">
        <span class="mc-muted">题库</span>
        <div class="mc-spacer" />
        <select v-model="catalogState.bankSort" class="mc-select bank-list-panel__sort" aria-label="题库排序">
          <option value="default">最新创建</option>
          <option value="questions">题量最多</option>
          <option value="name">按名称</option>
        </select>
      </div>

      <div v-if="catalogState.banksLoading && catalogState.banks.length === 0" class="bank-list-panel__loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton bank-list-panel__skeleton" />
      </div>

      <EmptyState
        v-else-if="catalogState.banks.length === 0"
        icon="bank"
        title="这个范围里还没有题库"
        :description="
          catalogState.navView === 'folder'
            ? '换个文件夹看看，或直接新建题库并放进当前文件夹。'
            : '这门课程下还没有题库，可以换个课程或新建题库。'
        "
        action-text="新建题库"
        @action="actionsState.openCreateBank(catalogState.currentFolderId)"
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
            <span class="bank-item__title">
              <span class="bank-item__name" :title="bank.name">{{ bank.name }}</span>
              <span
                v-if="bankCourseName(bank) !== ''"
                class="mc-badge mc-badge--success bank-item__badge"
                :title="bankLessonTitle(bank) !== '' ? `关联课时：${bankLessonTitle(bank)}` : '已关联课程'"
              >
                <Icon name="courses" :size="12" />
                已关联 · {{ bankCourseName(bank) }}
              </span>
            </span>
            <span class="mc-muted bank-item__meta">
              {{ KIND_LABEL[bank.kind ?? ''] ?? '' }} · {{ bank.question_count }} 题
            </span>
            <span v-if="bankFolderPath(bank) !== ''" class="mc-muted bank-item__path" :title="bankFolderPath(bank)">
              {{ bankFolderPath(bank) }}
            </span>
            <span
              v-if="practiceState.bankBadge(bank.id)"
              class="mc-badge bank-item__practice"
              :title="practiceState.bankBadge(bank.id)?.title"
            >
              {{ practiceState.bankBadge(bank.id)?.text }}
            </span>
          </div>
          <div class="bank-item__actions">
            <select
              v-if="catalogState.navView === 'course' && catalogState.selectedCourse === 'unbound'"
              class="mc-select bank-item__bind"
              aria-label="挂到课程"
              @click.stop
              @change="catalogState.bindBankCourse(bank, Number(($event.target as HTMLSelectElement).value) || null)"
            >
              <option value="">挂到课程…</option>
              <option v-for="course in catalogState.courses" :key="course.courseId" :value="course.courseId">
                {{ course.name }}
              </option>
            </select>
            <DropdownMenu
              :items="actionsState.bankRowMenuItems()"
              label=""
              icon="more"
              :show-caret="false"
              aria-label="题库操作（重命名 / 删除 / 关联课时）"
              variant="ghost"
              @select="(key) => actionsState.onBankRowMenu(bank, key)"
            />
          </div>
        </li>
      </ul>

      <button
        v-if="!catalogState.showAllBanks && catalogState.banks.length > catalogState.visibleBanks.length"
        class="mc-btn mc-btn--ghost mc-btn--sm bank-list-panel__more"
        type="button"
        @click="catalogState.showAllBanks = true"
      >
        显示全部 {{ catalogState.sortedBanks.length }} 个（当前只显示前 {{ catalogState.visibleBanks.length }} 个）
      </button>
    </div>
  </section>
</template>

<style scoped src="./bank-list-panel.css"></style>
