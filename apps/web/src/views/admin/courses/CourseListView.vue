<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import CourseGrid from './CourseGrid.vue';
import CourseTable from './CourseTable.vue';
import type { MenuItem } from '@/components/DropdownMenu.vue';
import type { Course, MediaRoot } from '@/api/types';
import type { useCourseList } from '@/composables/use-course-list';

/**
 * 「课程」选项卡：卡片头部 + 加载骨架 / 空状态 + 列表或平铺视图。
 * 增删改动作不在这里实现，只向页面转发。
 */
defineProps<{
  list: ReturnType<typeof useCourseList>;
  roots: MediaRoot[];
  menuItems: MenuItem[];
}>();

const emit = defineEmits<{
  (e: 'manage', course: Course): void;
  (e: 'edit', course: Course): void;
  (e: 'cover', course: Course): void;
  (e: 'delete', course: Course): void;
  (e: 'create'): void;
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">课程列表</span>
      <span class="mc-muted">
        {{ list.filtered.length }} / {{ list.courses.length }} 门 · 点击课程卡片进入它的课时管理
      </span>
    </div>

    <div v-if="list.loading && list.courses.length === 0" class="loading">
      <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="list.filtered.length === 0"
      icon="courses"
      title="没有匹配的课程"
      description="换个关键词或清空分类筛选；也可以点击下方按钮直接新建一门课程。"
      action-text="新建课程"
      @action="emit('create')"
    />

    <CourseGrid
      v-else-if="list.view === 'grid'"
      :courses="list.filtered"
      :categories="list.categories"
      :roots="roots"
      :menu-items="menuItems"
      @manage="emit('manage', $event)"
      @edit="emit('edit', $event)"
      @cover="emit('cover', $event)"
      @delete="emit('delete', $event)"
    />

    <CourseTable
      v-else
      :courses="list.filtered"
      :categories="list.categories"
      :roots="roots"
      :menu-items="menuItems"
      @manage="emit('manage', $event)"
      @edit="emit('edit', $event)"
      @cover="emit('cover', $event)"
      @delete="emit('delete', $event)"
    />
  </section>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 52px;
}
</style>
