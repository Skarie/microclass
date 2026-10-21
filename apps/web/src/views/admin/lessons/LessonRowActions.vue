<script setup lang="ts">
import type { useLessonOrder } from '@/composables/use-lesson-order';

/**
 * 课时行右侧动作：↑ / ↓ 调序、知识点、编辑、删除。
 * 调序走 use-lesson-order.moveTo，与拖拽共用同一套「先本地生效、失败回滚」逻辑。
 */
defineProps<{
  index: number;
  lessonCount: number;
  order: ReturnType<typeof useLessonOrder>;
}>();

const emit = defineEmits<{
  (e: 'knowledge'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
}>();
</script>

<template>
  <div class="lesson__actions">
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      title="上移"
      :disabled="index === 0"
      @click="order.moveTo(index, index - 1)"
    >
      ↑
    </button>
    <button
      class="mc-btn mc-btn--sm"
      type="button"
      title="下移"
      :disabled="index === lessonCount - 1"
      @click="order.moveTo(index, index + 1)"
    >
      ↓
    </button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('knowledge')">知识点</button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit')">编辑</button>
    <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="emit('delete')">删除</button>
  </div>
</template>

<style scoped>
.lesson__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
