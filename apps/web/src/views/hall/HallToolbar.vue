<script setup lang="ts">
import { reactive } from 'vue';
import Icon from '@/components/Icon.vue';
import Toolbar from '@/components/Toolbar.vue';
import type { HallCatalog } from '@/composables/use-hall-catalog';

/**
 * 大厅工具条（从 CourseHallView 抽出）：搜索、分类、只看收藏 / 未学完，
 * 右侧结果计数、平铺 / 列表切换与重置。状态在 useHallCatalog，这里只负责触发。
 */
const props = defineProps<{ catalog: HallCatalog }>();
const state = reactive(props.catalog);
</script>

<template>
  <Toolbar>
    <template #left>
      <label class="hall__search">
        <Icon name="search" :size="16" />
        <input
          v-model.trim="state.keyword"
          class="mc-input mc-input--search hall__search-input"
          type="search"
          placeholder="搜索课程名称或简介"
          aria-label="搜索课程"
        />
      </label>
      <label class="mc-checkbox">
        <input v-model="state.onlyFav" type="checkbox" />
        只看收藏
      </label>
      <label class="mc-checkbox">
        <input v-model="state.onlyUnfinished" type="checkbox" />
        只看未学完
      </label>
    </template>
    <template #right>
      <span class="mc-muted hall__count mc-num">
        {{
          state.hasFilter ? `筛选出 ${state.filtered.length} / ${state.courses.length}` : `共 ${state.courses.length}`
        }}
        门
      </span>
      <div class="hall__views" role="group" aria-label="呈现方式">
        <button
          class="mc-btn mc-btn--sm mc-btn--icon"
          :class="state.viewMode === 'cards' ? 'mc-btn--soft' : 'mc-btn--ghost'"
          type="button"
          :aria-pressed="state.viewMode === 'cards'"
          aria-label="卡片展示"
          title="卡片展示"
          @click="state.setViewMode('cards')"
        >
          <Icon name="grid" :size="16" />
        </button>
        <button
          class="mc-btn mc-btn--sm mc-btn--icon"
          :class="state.viewMode === 'list' ? 'mc-btn--soft' : 'mc-btn--ghost'"
          type="button"
          :aria-pressed="state.viewMode === 'list'"
          aria-label="列表展示"
          title="列表展示"
          @click="state.setViewMode('list')"
        >
          <Icon name="list" :size="16" />
        </button>
      </div>
      <button v-if="state.hasFilter" class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="state.resetFilters">
        <Icon name="reset" :size="16" />
        重置
      </button>
    </template>
  </Toolbar>
</template>

<style scoped>
.hall__search {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-3);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-muted);
  transition:
    border-color var(--mc-transition),
    background-color var(--mc-transition);
}

.hall__search:focus-within {
  border-color: var(--mc-primary);
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
}

/* 用后代选择器压过 .mc-input 的边框，避免 !important */
.hall__search .hall__search-input {
  min-width: 200px;
  border: none;
  outline: none;
  box-shadow: none;
  background: transparent;
}

.hall__count {
  font-size: var(--mc-text-xs);
}

.hall__views {
  display: flex;
  gap: var(--mc-space-1);
}

@media (max-width: 640px) {
  /* 窄屏：搜索独占一行，避免和分类下拉挤在同一条里参差不齐 */
  .hall__search {
    flex: 1 1 100%;
  }

  .hall__search .hall__search-input {
    min-width: 0;
    width: 100%;
  }
}
</style>
