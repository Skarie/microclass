<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 筛选状态由 useCourseList 持有，子组件就地编辑（与 BankFormDialog 一致） */
import { useCourseList } from '@/composables/use-course-list';
import Icon from '@/components/Icon.vue';

/**
 * 「课程」选项卡筛选行：搜索、分类筛选、统计与列表/平铺开关。
 * 筛选状态由 useCourseList 持有，这里就地编辑（页面只负责编排）。
 */
defineProps<{ list: ReturnType<typeof useCourseList> }>();
</script>

<template>
  <div class="mc-row mc-row--wrap toolbar__row">
    <input
      v-model.trim="list.keyword"
      class="mc-input toolbar__search"
      type="search"
      placeholder="搜索课程名称、简介或分类"
      aria-label="搜索课程"
    />
    <select v-model="list.categoryFilter" class="mc-select toolbar__select" aria-label="按分类筛选">
      <option value="">全部分类</option>
      <option v-for="c in list.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <span class="mc-muted toolbar__count">
      共 {{ list.courses.length }} 门 · 已发布 {{ list.publishedCount }} · 已绑定文件夹 {{ list.boundCount }} ·
      未归类课时
      {{ list.orphans.total }}
    </span>
    <div class="mc-spacer" />
    <div class="view-switch" role="group" aria-label="课程展示方式">
      <button
        class="view-switch__btn"
        :class="{ 'is-active': list.view === 'grid' }"
        type="button"
        aria-label="平铺展示"
        :aria-pressed="list.view === 'grid'"
        @click="list.setView('grid')"
      >
        ▦ 平铺
      </button>
      <button
        class="view-switch__btn"
        :class="{ 'is-active': list.view === 'list' }"
        type="button"
        aria-label="列表展示"
        :aria-pressed="list.view === 'list'"
        @click="list.setView('list')"
      >
        <Icon name="list" :size="16" />
        列表
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar__row {
  align-items: center;
}

.toolbar__search {
  width: 240px;
}

.toolbar__select {
  width: 170px;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}

.view-switch {
  display: inline-flex;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  overflow: hidden;
}

.view-switch__btn {
  border: 0;
  background: var(--mc-bg);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  padding: var(--mc-space-2) var(--mc-space-3);
  cursor: pointer;
}

.view-switch__btn + .view-switch__btn {
  border-left: 1px solid var(--mc-border);
}

.view-switch__btn.is-active {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

@media (max-width: 900px) {
  .toolbar__search,
  .toolbar__select {
    width: 100%;
  }
}
</style>
