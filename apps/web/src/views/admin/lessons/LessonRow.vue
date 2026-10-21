<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import LessonRowActions from './LessonRowActions.vue';
import type { Lesson } from '@/api/types';
import type { LessonRowModel } from '@/composables/use-course-lesson-manage';
import type { useLessonOrder } from '@/composables/use-lesson-order';

/**
 * 课时列表的一行：拖拽手柄、序号、封面、标题/路径、时长与 ↑↓/知识点/编辑/删除。
 * 拖拽与上下移动都走 use-lesson-order（拖拽后立即排序、失败回滚）。
 */
defineProps<{
  row: LessonRowModel;
  lessonCount: number;
  order: ReturnType<typeof useLessonOrder>;
}>();

const emit = defineEmits<{
  (e: 'edit', lesson: Lesson): void;
  (e: 'knowledge', lesson: Lesson): void;
  (e: 'delete', lesson: Lesson): void;
}>();

/** 秒 → 时:分:秒（无时长显示 —） */
function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <li
    class="lesson"
    :class="{
      'is-dragging': order.dragging === row.index,
      'is-over': order.dragOver === row.index && order.dragging !== null && order.dragging !== row.index,
    }"
    :draggable="true"
    @dragstart="order.onDragStart(row.index, $event)"
    @dragover="order.onDragOver(row.index, $event)"
    @dragend="order.onDragEnd"
    @drop.prevent="order.onDrop(row.index)"
  >
    <span class="lesson__handle" aria-hidden="true" title="拖拽调整顺序">⠿</span>
    <span class="lesson__index mc-mono">{{ row.index + 1 }}</span>

    <div class="lesson__cover">
      <img
        v-if="row.lesson.cover_path"
        :src="`/api/v1/lesson-covers/${row.lesson.id}`"
        :alt="row.lesson.title"
        loading="lazy"
      />
      <Icon v-else name="video" :size="16" />
    </div>

    <div class="lesson__text">
      <div class="lesson__title-row">
        <RouterLink
          class="lesson__title"
          :to="{ name: 'watch', params: { id: row.lesson.id } }"
          :title="row.lesson.title"
        >
          {{ row.lesson.title }}
        </RouterLink>
        <span v-if="row.lesson.source === 'manual'" class="mc-badge lesson__badge">手工</span>
      </div>
      <span class="mc-muted mc-truncate lesson__path">{{ row.lesson.video_path }}</span>
    </div>

    <span class="mc-muted lesson__duration">{{ formatDuration(row.lesson.duration) }}</span>

    <LessonRowActions
      :index="row.index"
      :lesson-count="lessonCount"
      :order="order"
      @knowledge="emit('knowledge', row.lesson)"
      @edit="emit('edit', row.lesson)"
      @delete="emit('delete', row.lesson)"
    />
  </li>
</template>

<style scoped>
.lesson {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
  background: var(--mc-bg);
}

.lesson.is-dragging {
  opacity: 0.45;
}

.lesson.is-over {
  box-shadow: inset 0 2px 0 var(--mc-primary);
}

.lesson__handle {
  cursor: grab;
  color: var(--mc-text-muted);
  user-select: none;
  font-size: var(--mc-text-lg);
  line-height: var(--mc-leading-display);
}

.lesson__index {
  width: 28px;
  text-align: right;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
}

.lesson__cover {
  flex: none;
  width: 76px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.lesson__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lesson__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.lesson__title-row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.lesson__title {
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lesson__title:hover {
  color: var(--mc-primary-fg);
}

.lesson__badge {
  font-size: var(--mc-text-xs);
}

.lesson__path {
  font-size: var(--mc-text-xs);
  max-width: 520px;
}

.lesson__duration {
  font-size: var(--mc-text-xs);
  width: 64px;
  text-align: right;
}

@media (max-width: 900px) {
  .lesson {
    flex-wrap: wrap;
  }

  .lesson__path {
    max-width: 100%;
  }
}
</style>
