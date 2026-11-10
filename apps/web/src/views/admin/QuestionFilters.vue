<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import { FACET_ALL, FACET_NONE } from '@/utils/question-sections';
import { TYPE_LABEL, TYPE_OPTIONS } from './questionTypes';
import type { useQuestionList } from '@/composables/use-question-list';

/**
 * 右栏筛选条（从 BankAdminView 抽出）：
 * 题型 chip、难度 chip、题干关键词（输入即搜）、重置、显示偏好、更多筛选。
 * 关键词输入框的 DOM ref 回填给组合式函数，父页面的 “/” 快捷键仍能聚焦。
 */
const props = defineProps<{
  questions: ReturnType<typeof useQuestionList>;
}>();

const questionApi = props.questions;
const questionsState = reactive(questionApi);
const keywordInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  questionApi.keywordInput.value = keywordInput.value;
});
onBeforeUnmount(() => {
  questionApi.keywordInput.value = null;
});
</script>

<template>
  <div class="mc-row mc-row--wrap filters">
    <div class="chips" role="group" aria-label="按题型筛选">
      <button
        class="chip"
        :class="{ 'chip--active': questionsState.typeFilter === '' }"
        type="button"
        @click="questionsState.setTypeFilter('')"
      >
        全部题型
      </button>
      <button
        v-for="t in TYPE_OPTIONS"
        :key="t"
        class="chip"
        :class="{ 'chip--active': questionsState.typeFilter === t }"
        type="button"
        @click="questionsState.setTypeFilter(t)"
      >
        {{ TYPE_LABEL[t] }}
      </button>
    </div>
    <div class="chips" role="group" aria-label="按难度筛选">
      <button
        class="chip"
        :class="{ 'chip--active': questionsState.difficultyFilter === '' }"
        type="button"
        @click="questionsState.setDifficultyFilter('')"
      >
        全部难度
      </button>
      <button
        v-for="d in questionsState.DIFFICULTY_OPTIONS"
        :key="d.value"
        class="chip"
        :class="{ 'chip--active': questionsState.difficultyFilter === d.value }"
        type="button"
        @click="questionsState.setDifficultyFilter(d.value)"
      >
        {{ d.label }}
      </button>
    </div>
    <!-- 输入即搜（400ms 防抖），不再需要点"搜索" -->
    <input
      ref="keywordInput"
      v-model.trim="questionsState.keyword"
      class="mc-input filters__keyword"
      type="search"
      placeholder="搜索题干关键词（输入即搜）"
      aria-label="搜索题干"
      @keyup.enter="questionsState.search"
    />
    <!-- 章节 / 小节筛选：候选来自当前题库的题目（后端按自然序返回） -->
    <select
      class="mc-select filters__select"
      :value="questionsState.chapterValue"
      aria-label="按章节筛选"
      @change="questionsState.onChapterSelect"
    >
      <option :value="FACET_ALL">全部章节</option>
      <option v-for="chapter in questionsState.chapterOptions" :key="chapter" :value="chapter">{{ chapter }}</option>
      <option :value="FACET_NONE">未分章</option>
    </select>
    <select
      class="mc-select filters__select"
      :value="questionsState.sectionValue"
      aria-label="按小节筛选"
      @change="questionsState.onSectionSelect"
    >
      <option :value="FACET_ALL">全部小节</option>
      <option v-for="section in questionsState.sectionOptions" :key="section" :value="section">{{ section }}</option>
      <option :value="FACET_NONE">未分节</option>
    </select>
    <!-- 题组筛选（迁移 0029）：一个题组 = 同一考点的一道母题 + 若干变式，选中后只看组内题目 -->
    <select
      class="mc-select filters__select"
      :value="questionsState.groupFilter ?? ''"
      aria-label="按题组筛选"
      @focus="questionsState.loadGroupOptions"
      @change="questionsState.onGroupSelect"
    >
      <option value="">全部题组</option>
      <option v-for="group in questionsState.groupOptions" :key="group.id" :value="String(group.id)">
        {{ group.title }}（{{ group.total }} 题）
      </option>
    </select>
    <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="questionsState.resetFilters">重置</button>
    <DropdownMenu
      :items="questionsState.viewMenuItems"
      label="显示"
      :icon="null"
      variant="ghost"
      @select="questionsState.onViewMenu"
    />
    <label class="filters__more">
      <input v-model="questionsState.showMoreFilters" type="checkbox" aria-label="展开更多筛选" />
      更多筛选
    </label>
    <label
      v-if="questionsState.showMoreFilters"
      class="filters__check"
      title="解析本身是一张图（文字在图里）：搜不到、也改不了，先筛出来"
    >
      <input
        v-model="questionsState.mediaOnlyFilter"
        type="checkbox"
        aria-label="只看解析只有图片"
        @change="questionsState.search"
      />
      只看「解析只有图片」
    </label>
  </div>
</template>

<style scoped>
/* 题型/难度 chip 组：一眼看到全部可选值，少一次点击 */
.chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--mc-space-1);
}

.chip {
  min-height: 32px;
  padding: 8px 12px;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
  cursor: pointer;
  white-space: nowrap;
}

.chip:hover {
  border-color: var(--mc-primary-border);
  color: var(--mc-primary-fg);
}

.chip--active {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.filters {
  gap: var(--mc-space-2);
  padding-bottom: var(--mc-space-2);
  border-bottom: 1px solid var(--mc-border);
}

.filters__keyword {
  flex: 1 1 240px;
  width: 260px;
}

/* 章节 / 小节下拉：与关键词同一条筛选行，长章节名截断但保留悬停提示 */
.filters__select {
  flex: 0 1 160px;
  min-width: 120px;
  max-width: 200px;
}

.filters__more {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  gap: 8px;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
  cursor: pointer;
}

/* 整行 label 都是点击区：复选框本身只有 13px，手指点不准 */
.filters__check {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  gap: var(--mc-space-1);
  font-size: 0.9em;
  color: var(--mc-text-muted);
  white-space: nowrap;
  cursor: pointer;
}
</style>
