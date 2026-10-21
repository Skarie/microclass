<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 分类弹窗状态由 use-category-admin 持有，弹窗就地编辑 */
import AppModal from '@/components/AppModal.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Category, Course } from '@/api/types';
import type { useCategoryAdmin } from '@/composables/use-category-admin';

/**
 * 分类管理弹窗：新增 / 删除分类。删除只改课程分类，不删除课程。
 */
defineProps<{
  categoryAdmin: ReturnType<typeof useCategoryAdmin>;
  categories: Category[];
  courses: Course[];
  orphanTotal: number;
}>();
</script>

<template>
  <AppModal :open="categoryAdmin.catOpen" title="分类管理" width="520px" @close="categoryAdmin.closeCategories()">
    <div class="mc-col">
      <div class="mc-row mc-row--wrap">
        <input
          v-model.trim="categoryAdmin.newCategoryName"
          class="mc-input cat__input"
          type="text"
          maxlength="40"
          placeholder="新分类名称"
          @keyup.enter="categoryAdmin.addCategory()"
        />
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="categoryAdmin.catBusy"
          @click="categoryAdmin.addCategory()"
        >
          添加
        </button>
      </div>

      <p class="mc-hint">
        分类用于课程大厅的筛选。删除分类不会删除课程，只会把课程改为「未分类」（当前共
        {{ orphanTotal }} 个未归类课时）。
      </p>

      <EmptyState
        v-if="categories.length === 0"
        icon="list"
        title="还没有分类"
        description="在上方输入名称即可创建第一个分类。"
      />

      <ul v-else class="cat__list">
        <li v-for="c in categories" :key="c.id" class="cat__item">
          <span class="cat__name">{{ c.name }}</span>
          <div class="mc-spacer" />
          <span class="mc-muted cat__count">{{ courses.filter((x) => x.category_id === c.id).length }} 门课程</span>
          <button
            class="mc-btn mc-btn--sm mc-btn--danger"
            type="button"
            :disabled="categoryAdmin.catBusy"
            @click="categoryAdmin.removeCategory(c)"
          >
            删除
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="categoryAdmin.closeCategories()">关闭</button>
    </template>
  </AppModal>
</template>

<style scoped>
.cat__input {
  flex: 1;
  min-width: 200px;
}

.cat__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-height: 320px;
  overflow-y: auto;
}

.cat__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.cat__name {
  font-weight: var(--mc-font-medium);
}

.cat__count {
  font-size: var(--mc-text-xs);
}
</style>
