<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 范围状态由 useExamRange 持有，子组件就地编辑（与课程筛选行一致） */
import Icon from '@/components/Icon.vue';
import RangeTree from '@/components/compose/RangeTree.vue';
import type { ExamRange } from '@/composables/use-exam-range';

/**
 * 第①步「圈定出题范围」：本课程 / 全库切换 + 范围树（册次→章节→知识点）+ 下一步。
 * 勾选状态由父级的 useExamRange 持有，这里只负责展示与触发重新统计。
 */
defineProps<{ range: ExamRange }>();
const emit = defineEmits<{ next: [] }>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">① 圈定出题范围</span>
      <span class="mc-spacer" />
      <label class="mc-row stp__scope">
        <span class="mc-label">范围</span>
        <select v-model="range.scope" class="mc-select" aria-label="抽题范围" @change="range.loadFacets()">
          <option value="course">本课程</option>
          <option value="all">全库所有题（跨课程）</option>
        </select>
      </label>
    </div>
    <div class="mc-card__body mc-col">
      <p class="mc-hint">
        勾<strong>章节</strong>或<strong>知识点</strong>都可以，可跨章节、跨册、多选；不勾就是本课程全部题目。
        当前范围：<strong>{{ range.rangeSummary }}</strong>
      </p>
      <p v-if="(range.facets?.total ?? 0) === 0 && range.scope === 'course'" class="stp__emptyhint">
        <Icon name="alert" :size="16" />
        <span>本课程没有绑定题库的题目（导入的题常常只归到题库）。把右上角范围改成「全库所有题」就能按章节挑。</span>
      </p>
      <button
        v-if="(range.facets?.total ?? 0) === 0 && range.scope === 'course'"
        class="mc-btn mc-btn--soft mc-btn--sm"
        type="button"
        @click="
          range.scope = 'all';
          range.loadFacets();
        "
      >
        改成「全库所有题」
      </button>
      <RangeTree
        v-model:selected="range.selected"
        :books="range.facets?.books ?? []"
        :points-by-chapter="range.pointsByChapter"
        :loading-points="range.loadingPoints"
        @need-points="range.loadPointsOfChapter"
        @search-points="range.searchPoints"
        @update:selected="range.loadFacets"
      />
      <div class="stp__row">
        <span class="mc-muted">
          范围内共 <strong>{{ range.facets?.total ?? 0 }}</strong> 题可选（{{
            range.rangeLoading ? '统计中…' : '已统计'
          }}）
        </span>
        <span class="mc-spacer" />
        <button class="mc-btn mc-btn--primary" type="button" @click="emit('next')">
          下一步：选择组卷方式
          <Icon name="arrow-right" :size="16" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stp__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  padding-top: var(--mc-space-2);
}

.stp__emptyhint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: var(--mc-space-2);
  border: 1px solid var(--mc-warning-border);
  border-radius: var(--mc-radius);
  background: var(--mc-warning-soft);
  font-size: var(--mc-text-sm);
}

.stp__scope {
  gap: var(--mc-space-2);
}
</style>
