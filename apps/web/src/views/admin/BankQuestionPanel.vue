<script setup lang="ts">
import { computed, reactive } from 'vue';
import { RouterLink } from 'vue-router';
import DropdownMenu from '@/components/DropdownMenu.vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import QuestionFilters from './QuestionFilters.vue';
import QuestionTable from './QuestionTable.vue';
import QuestionPager from './QuestionPager.vue';
import { bankCourseName, bankLessonTitle } from './bankTypes';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useQuestionList } from '@/composables/use-question-list';
import type { useBankImport } from '@/composables/use-bank-import';
import type { useBankActions } from '@/composables/use-bank-actions';
import type { usePracticeLinks } from '@/composables/use-practice-links';

/**
 * 右栏题库面板（从 BankAdminView 抽出）：
 * 题库头部（标题 / 关联课程 / 课时 / 题量 / 导出 / 导入 / 新建）、筛选条、
 * 批量条、空态/骨架、题目表格与分页。
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
const practiceState = reactive(practiceApi);

/** 详情面板标题区的关联课程 / 课时；没有课程 id 时只展示课程名，不猜路由 */
const selectedCourseName = computed(() => (catalogState.selectedBank ? bankCourseName(catalogState.selectedBank) : ''));
const selectedCourseId = computed(() =>
  catalogState.selectedBank ? catalogApi.courseIdOfBank(catalogState.selectedBank) : null,
);
const selectedLessonTitle = computed(() =>
  catalogState.selectedBank ? bankLessonTitle(catalogState.selectedBank) : '',
);
/** 整库粒度的关联徽标：已关联 N 课时 */
const bankLinkBadge = computed(() =>
  catalogState.selectedBank ? practiceState.bankBadge(catalogState.selectedBank.id) : null,
);
</script>

<template>
  <section class="mc-card question-panel">
    <!-- 题库头部：标题单行截断 + 右侧操作区固定（标题很长时不会把按钮挤到下一行） -->
    <div class="mc-card__header bank-head">
      <div class="bank-head__title">
        <div class="bank-head__line">
          <span class="bank-head__name mc-truncate">{{
            catalogState.selectedBank ? catalogState.selectedBank.name : '请选择题库'
          }}</span>
          <span v-if="catalogState.selectedBank" class="bank-head__count mc-muted">
            共 {{ questionsState.total }} 题
          </span>
        </div>
        <div v-if="catalogState.selectedBank" class="bank-head__course mc-muted">
          <template v-if="selectedCourseName !== ''">
            <span class="bank-head__course-item">
              关联课程：
              <RouterLink
                v-if="selectedCourseId !== null"
                class="bank-head__course-link"
                :to="{ name: 'admin-course-lessons', params: { id: selectedCourseId } }"
              >
                {{ selectedCourseName }}
              </RouterLink>
              <span v-else>{{ selectedCourseName }}</span>
            </span>
            <span v-if="selectedLessonTitle !== ''" class="bank-head__course-item"
              >课时：{{ selectedLessonTitle }}</span
            >
          </template>
          <span v-else>未关联课程</span>
          <!-- 整库粒度的关联标记：放在副标题行，避免把长题库名挤到省略号 -->
          <span v-if="bankLinkBadge" class="mc-badge bank-head__badge" :title="bankLinkBadge.title">
            {{ bankLinkBadge.text }}
          </span>
        </div>
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
          :disabled="!catalogState.selectedBank"
          @click="catalogState.selectedBank && practiceState.openBankLink(catalogState.selectedBank, selectedCourseId)"
        >
          <Icon name="courses" :size="15" />
          关联课时
        </button>
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
          class="mc-btn mc-btn--sm mc-btn--soft"
          type="button"
          :disabled="questionsState.bulkBusy"
          @click="questionsState.openSectionsDialog"
        >
          设置章节/小节
        </button>
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
        <QuestionTable
          :questions="questionApi"
          :bank="catalogState.selectedBank"
          :practice="practiceApi"
          :course-id="selectedCourseId"
        />
        <QuestionPager :questions="questionApi" />
      </template>
    </div>
  </section>
</template>

<style scoped src="./bank-question-panel.css"></style>
