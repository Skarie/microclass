<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import LessonChapter from './LessonChapter.vue';
import LessonRow from './LessonRow.vue';
import type { Lesson } from '@/api/types';
import type { useCourseLessonManage } from '@/composables/use-course-lesson-manage';
import type { useLessonOrder } from '@/composables/use-lesson-order';

/**
 * 课时列表卡片：加载骨架、空态引导、章节分组与可拖拽的课时行。
 * 数据与拖拽状态由 use-course-lesson-manage / use-lesson-order 提供。
 */
const props = defineProps<{
  manage: ReturnType<typeof useCourseLessonManage>;
  order: ReturnType<typeof useLessonOrder>;
}>();

const emit = defineEmits<{
  (e: 'upload'): void;
  (e: 'create'): void;
  (e: 'scan'): void;
  (e: 'edit', lesson: Lesson): void;
  (e: 'knowledge', lesson: Lesson): void;
  (e: 'delete', lesson: Lesson): void;
}>();

/** 每个章节的课时数：同一组名在列表里可能出现多次，按组名汇总 */
const chapterTotals = computed(() => {
  const totals = new Map<string, number>();
  for (const lesson of props.manage.lessons) {
    totals.set(lesson.group_name, (totals.get(lesson.group_name) ?? 0) + 1);
  }
  return totals;
});
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">课时（{{ manage.lessons.length }}）</span>
      <span class="mc-muted">
        拖拽左侧手柄或使用 ↑↓ 调整顺序
        <template v-if="order.savingOrder"> · 保存中…</template>
      </span>
    </div>

    <div v-if="manage.loading && manage.lessons.length === 0" class="loading">
      <div v-for="i in 5" :key="i" class="mc-skeleton loading__row" />
    </div>

    <div v-else-if="manage.lessons.length === 0" class="empty-wrap">
      <EmptyState
        icon="video"
        title="这门课程还没有课时"
        description="推荐做法：绑定课程的视频文件夹后点「扫描文件夹」批量导入；也可以直接上传视频或新建单个课时。"
        action-text="扫描文件夹"
        @action="emit('scan')"
      />
      <div class="mc-row empty-extra">
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('upload')">上传视频</button>
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('create')">新建课时</button>
      </div>
    </div>

    <ul v-else class="lesson-list" role="list">
      <template v-for="row in manage.rows" :key="row.lesson.id">
        <LessonChapter
          v-if="row.showChapter"
          :name="row.lesson.group_name"
          :count="chapterTotals.get(row.lesson.group_name) ?? 0"
        />
        <LessonRow
          :row="row"
          :lesson-count="manage.lessons.length"
          :order="order"
          @edit="emit('edit', $event)"
          @knowledge="emit('knowledge', $event)"
          @delete="emit('delete', $event)"
        />
      </template>
    </ul>
  </section>
</template>

<style scoped>
.lesson-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 52px;
}

.empty-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mc-space-3);
  padding-bottom: var(--mc-space-5);
}

.empty-extra {
  gap: var(--mc-space-2);
}
</style>
