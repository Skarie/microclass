<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { useCourseLessons } from '@/composables/use-course-lessons';

/**
 * 「未归类课时」筛选行：说明文案与刷新/不归类上传/新建入口。
 */
defineProps<{ lessons: ReturnType<typeof useCourseLessons> }>();
const emit = defineEmits<{ (e: 'upload'): void; (e: 'create'): void }>();
</script>

<template>
  <div class="mc-row mc-row--wrap toolbar__row">
    <span class="mc-muted toolbar__count">
      这些课时没有归属（上传时没选课程、或课程被删除）。勾选后可批量改绑到课程，也可以直接删除。
    </span>
    <div class="mc-spacer" />
    <button class="mc-btn mc-btn--sm" type="button" :disabled="lessons.orphanLoading" @click="lessons.loadOrphans()">
      刷新
    </button>
    <button class="mc-btn mc-btn--sm" type="button" @click="emit('upload')">
      <Icon name="upload" :size="15" /> 上传视频（不归类）
    </button>
    <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('create')">新建课时</button>
  </div>
</template>

<style scoped>
.toolbar__row {
  align-items: center;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}
</style>
