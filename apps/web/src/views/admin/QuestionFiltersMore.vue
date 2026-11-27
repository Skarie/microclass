<script setup lang="ts">
import { reactive } from 'vue';
import DropdownMenu from '@/components/DropdownMenu.vue';
import FilterMultiSelect from '@/components/FilterMultiSelect.vue';
import { FACET_ALL, FACET_NONE } from '@/utils/question-sections';
import type { useQuestionList } from '@/composables/use-question-list';

/**
 * 「更多筛选」面板（默认收起，见 QuestionFilters）：章节 / 小节 / 题组 / 标签 /
 * 知识点 / 只看纯图片解析，外加表格显示偏好与重置。
 *
 * 这里只放低频条件：首屏三个高频条件（题型、难度、关键词）留在 QuestionFilters。
 * 标签与知识点共用 `<FilterMultiSelect>`，选中两个以上时出现「任意一个 / 同时包含」，
 * 对应后端的 tagMode / pointMode，筛选语义与拆分前一致。
 */
const props = defineProps<{ questions: ReturnType<typeof useQuestionList> }>();
const more = reactive(props.questions);
</script>

<template>
  <div id="question-filter-more" class="more mc-row mc-row--wrap">
    <!-- 章节 / 小节筛选：候选来自当前题库的题目（后端按自然序返回） -->
    <select
      class="mc-select more__select"
      :value="more.chapterValue"
      aria-label="按章节筛选"
      @change="more.onChapterSelect"
    >
      <option :value="FACET_ALL">全部章节</option>
      <option v-for="chapter in more.chapterOptions" :key="chapter" :value="chapter">{{ chapter }}</option>
      <option :value="FACET_NONE">未分章</option>
    </select>
    <select
      class="mc-select more__select"
      :value="more.sectionValue"
      aria-label="按小节筛选"
      @change="more.onSectionSelect"
    >
      <option :value="FACET_ALL">全部小节</option>
      <option v-for="section in more.sectionOptions" :key="section" :value="section">{{ section }}</option>
      <option :value="FACET_NONE">未分节</option>
    </select>
    <!-- 题组（迁移 0029）：一个题组 = 同一考点的一道母题 + 若干变式，选中后只看组内题目 -->
    <select
      class="mc-select more__select"
      :value="more.groupFilter ?? ''"
      aria-label="按题组筛选"
      @focus="more.loadGroupOptions"
      @change="more.onGroupSelect"
    >
      <option value="">全部题组</option>
      <option v-for="group in more.groupOptions" :key="group.id" :value="String(group.id)">
        {{ group.title }}（{{ group.total }} 题）
      </option>
    </select>

    <!-- 标签（迁移 0030）：多选 + 任意/全部；选中后列表只留命中标签的题 -->
    <FilterMultiSelect
      label="标签"
      :options="more.tagFilterOptions"
      :model-value="more.tagFilterValues"
      :mode="more.tagMode"
      placeholder="添加标签筛选…"
      @update:model-value="more.setTagFilterValues"
      @update:mode="more.setTagMode"
    />

    <!-- 知识点多选：与标签同一套 any/all 语义（候选从已加载题目里汇总） -->
    <FilterMultiSelect
      label="知识点"
      :options="more.pointFilterOptions"
      :model-value="more.pointFilterValues"
      :mode="more.pointMode"
      placeholder="添加知识点…"
      @update:model-value="more.setPointFilterValues"
      @update:mode="more.setPointMode"
    />

    <label class="more__check" title="解析本身是一张图（文字在图里）：搜不到、也改不了，先筛出来">
      <input v-model="more.mediaOnlyFilter" type="checkbox" aria-label="只看解析只有图片" @change="more.search" />
      只看「解析只有图片」
    </label>

    <!-- 显示偏好与重置：低频动作，收在面板尾部；显示偏好不是筛选条件，不计入按钮计数 -->
    <span class="more__actions">
      <DropdownMenu :items="more.viewMenuItems" label="显示" :icon="null" variant="ghost" @select="more.onViewMenu" />
      <button
        class="mc-btn mc-btn--sm mc-btn--ghost"
        type="button"
        title="清空全部筛选条件（含题型、难度、关键词）"
        @click="more.resetFilters"
      >
        重置
      </button>
    </span>
  </div>
</template>

<style scoped>
.more {
  width: 100%;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  border-radius: var(--mc-radius);
  background: var(--mc-surface-2);
}

.more__select {
  flex: 0 1 160px;
  min-width: 120px;
  max-width: 200px;
}

/* 整行 label 都是点击区：复选框本身只有 13px，手指点不准 */
.more__check {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
  white-space: nowrap;
  cursor: pointer;
}

.more__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-left: auto;
}

@media (max-width: 900px) {
  .more {
    flex-direction: column;
    align-items: stretch;
  }

  .more__select {
    flex: 1 1 auto;
    width: 100%;
    max-width: none;
    min-height: var(--mc-touch-target-mobile);
  }

  .more__check {
    min-height: var(--mc-touch-target-mobile);
  }

  .more__actions {
    margin-left: 0;
  }

  .more__actions .mc-btn {
    flex: 1;
  }
}
</style>
