<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import QuestionFilterChips from './QuestionFilterChips.vue';
import QuestionFiltersMore from './QuestionFiltersMore.vue';
import { groupLabelOf } from '@/utils/question-sections';
import { TYPE_LABEL, TYPE_OPTIONS } from './questionTypes';
import type { useQuestionList } from '@/composables/use-question-list';

/**
 * 右栏筛选条（从 BankAdminView 抽出）：
 * 首屏只留三个高频条件——题型 / 难度 / 关键词；章节、小节、题组、标签、知识点、
 * 只看纯图片解析、显示偏好与重置都收进「更多筛选」。
 *
 * 「更多筛选 · N」的 N = 已启用的次级条件数，与收起时那行可删除 chips 一一对应
 * （标签 / 知识点按单个值计数，避免「标签 · 2」看不出是哪两个）。
 * 展开状态记在 sessionStorage：分页、切题、切视图回来都不收起。
 * 关键词输入框的 DOM ref 回填给组合式函数，父页面的 “/” 快捷键仍能聚焦。
 */
const props = defineProps<{ questions: ReturnType<typeof useQuestionList> }>();
const questionApi = props.questions;
const questionsState = reactive(questionApi);
const keywordInput = ref<HTMLInputElement | null>(null);

/** 展开状态只是展示偏好，不进请求参数；会话内保持（组件按视图重建后仍恢复） */
const EXPANDED_KEY = 'mc:bank-filters:expanded';
function readExpanded(): boolean {
  try {
    return sessionStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}
if (readExpanded()) questionsState.showMoreFilters = true;
watch(
  () => questionsState.showMoreFilters,
  (open) => {
    try {
      sessionStorage.setItem(EXPANDED_KEY, open ? '1' : '0');
    } catch {
      // 隐私模式禁止写入：退化成只在当前组件生命周期内记住
    }
  },
);

onMounted(() => {
  questionApi.keywordInput.value = keywordInput.value;
  // 标签候选：进页面拉一次（接口自带 1s 复用，写操作会清缓存）
  questionApi.loadTagFilterOptions();
});
onBeforeUnmount(() => {
  questionApi.keywordInput.value = null;
});

/**
 * 次级条件 chips：一个已选值 = 一条，所以 chips 数与按钮计数天然一致。
 * 标签 / 知识点按单个值拆开；章节 / 小节的空串是合法筛选值（未分章 / 未分节）。
 */
const moreChips = computed(() => {
  const chips: { key: string; label: string }[] = [];
  const { chapterFilter, sectionFilter, groupFilter } = questionsState;
  // 收起时也要看得出「同时包含」：只在会改变结果（≥2 项）时才给标签 / 知识点加后缀
  const tagAll = questionsState.tagMode === 'all' && questionsState.tagFilterValues.length >= 2;
  const pointAll = questionsState.pointMode === 'all' && questionsState.pointFilterValues.length >= 2;
  if (chapterFilter !== null) chips.push({ key: 'chapter', label: `章节：${groupLabelOf(chapterFilter)}` });
  if (sectionFilter !== null) chips.push({ key: 'section', label: `小节：${sectionFilter || '未分节'}` });
  if (groupFilter !== null) {
    const group = questionsState.groupOptions.find((item) => item.id === groupFilter);
    chips.push({ key: 'group', label: `题组：${group?.title ?? `#${groupFilter}`}` });
  }
  for (const value of questionsState.tagFilterValues) {
    const tag = questionsState.tagFilterOptions.find((option) => option.value === value);
    chips.push({ key: `tag:${value}`, label: `标签：${tag?.label ?? value}${tagAll ? '（同时包含）' : ''}` });
  }
  for (const point of questionsState.pointFilterValues) {
    chips.push({ key: `point:${point}`, label: `知识点：${point}${pointAll ? '（同时包含）' : ''}` });
  }
  if (questionsState.mediaOnlyFilter) chips.push({ key: 'media', label: '只看「解析只有图片」' });
  return chips;
});

/** 点 chips 的 ×：等价于在面板里把那一项清掉，走同一套 setter / search */
function removeChip(key: string): void {
  if (key === 'chapter') {
    questionsState.setChapterFilter(null);
  } else if (key === 'section') {
    questionsState.setSectionFilter(null);
  } else if (key === 'group') {
    questionsState.groupFilter = null;
    questionsState.search();
  } else if (key === 'media') {
    questionsState.mediaOnlyFilter = false;
    questionsState.search();
  } else if (key.startsWith('tag:')) {
    const value = key.slice(4);
    questionsState.setTagFilterValues(questionsState.tagFilterValues.filter((item) => item !== value));
  } else if (key.startsWith('point:')) {
    const point = key.slice(6);
    questionsState.setPointFilterValues(questionsState.pointFilterValues.filter((item) => item !== point));
  }
}
</script>

<template>
  <div class="filters">
    <div class="filters__primary mc-row mc-row--wrap">
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
      <button
        class="mc-btn mc-btn--sm mc-btn--ghost filters__toggle"
        :class="{ 'filters__toggle--on': questionsState.showMoreFilters }"
        type="button"
        :aria-expanded="questionsState.showMoreFilters"
        :aria-controls="questionsState.showMoreFilters ? 'question-filter-more' : undefined"
        @click="questionsState.showMoreFilters = !questionsState.showMoreFilters"
      >
        <Icon name="filter" :size="16" />
        更多筛选<span v-if="moreChips.length > 0"> · {{ moreChips.length }}</span>
        <Icon :name="questionsState.showMoreFilters ? 'chevron-up' : 'chevron-down'" :size="14" />
      </button>
    </div>

    <!-- 展开/收起 150ms：只动透明度与位移，不逐帧改高度 -->
    <Transition name="fold">
      <QuestionFiltersMore v-if="questionsState.showMoreFilters" :questions="questionApi" />
    </Transition>

    <!-- 收起时把生效的次级条件摊开：不用展开面板也能核对，并一条条清掉 -->
    <div
      v-if="questionsState.hasTagFilter || (!questionsState.showMoreFilters && moreChips.length > 0)"
      class="filters__meta mc-row mc-row--wrap"
    >
      <QuestionFilterChips
        v-if="!questionsState.showMoreFilters && moreChips.length > 0"
        :chips="moreChips"
        @remove="removeChip"
      />
      <!-- 有标签筛选时给出「筛选出 X / Y」：Y 是整本题库的题量，避免误以为题库变小了 -->
      <span v-if="questionsState.hasTagFilter" class="filters__result">
        筛选出 {{ questionsState.total }} / {{ questionsState.bankQuestionTotal }} 题
      </span>
    </div>
  </div>
</template>

<style scoped src="./question-filters.css"></style>
