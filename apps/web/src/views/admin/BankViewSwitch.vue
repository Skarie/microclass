<script setup lang="ts">
/**
 * 题库页视图切换：题目 / 题组 / 标签。
 *
 * 三个视图共用左侧文件夹树与「题库」概念，但右边展示的是三种东西：
 *   题目 —— 某个题库里的题（表格 + 筛选 + 批量操作）；
 *   题组 —— 跨题库的「母题 + 变式」关联（P0，列表 + 详情）；
 *   标签 —— 跨题库的教研标记（P1，易错 / 高考真题 / 自编 等，列表 + 维护）。
 * 做成顶部分段按钮而不是左侧分区，是因为它切换的是整页主区，不是筛选。
 */
const model = defineModel<'questions' | 'groups' | 'tags'>({ required: true });

const TABS = [
  { key: 'questions', label: '题目' },
  { key: 'groups', label: '题组' },
  { key: 'tags', label: '标签' },
] as const;
</script>

<template>
  <div class="view-switch" role="tablist" aria-label="题库视图">
    <button
      v-for="tab in TABS"
      :key="tab.key"
      class="view-switch__tab"
      :class="{ 'view-switch__tab--on': model === tab.key }"
      type="button"
      role="tab"
      :aria-selected="model === tab.key"
      @click="model = tab.key"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<style scoped>
.view-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
}

.view-switch__tab {
  min-height: 32px;
  padding: 0 var(--mc-space-4);
  border: 1px solid transparent;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  cursor: pointer;
}

.view-switch__tab:hover {
  color: var(--mc-primary-fg);
}

.view-switch__tab--on {
  border-color: var(--mc-primary-border);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

@media (max-width: 900px) {
  .view-switch {
    width: 100%;
  }

  .view-switch__tab {
    flex: 1;
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
