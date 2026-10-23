<script setup lang="ts">
import { computed } from 'vue';
import Toolbar from '@/components/Toolbar.vue';
import type { Course, Lesson } from '@/api/types';
import type { StatsTab } from './stats-types';

/**
 * 统计范围工具栏：课时/课程页签 + 课程下拉 + 课时下拉（仅课时页签）。
 * v-model 写回收缩成 change 事件，数字 id 的类型与拆分前保持一致。
 */
const props = defineProps<{
  tab: StatsTab;
  courses: Course[];
  courseId: number | '';
  lessons: Lesson[];
  lessonId: number | '';
  lessonsLoading: boolean;
}>();

const emit = defineEmits<{
  'tab-change': [tab: StatsTab];
  'course-change': [id: number | ''];
  'lesson-change': [id: number | ''];
}>();

const courseModel = computed({
  get: () => props.courseId,
  set: (id: number | '') => emit('course-change', id),
});

const lessonModel = computed({
  get: () => props.lessonId,
  set: (id: number | '') => emit('lesson-change', id),
});
</script>

<template>
  <Toolbar>
    <template #left>
      <div class="tabs">
        <button
          class="mc-btn mc-btn--sm"
          :class="{ 'mc-btn--primary': tab === 'lesson' }"
          type="button"
          @click="emit('tab-change', 'lesson')"
        >
          课时统计
        </button>
        <button
          class="mc-btn mc-btn--sm"
          :class="{ 'mc-btn--primary': tab === 'course' }"
          type="button"
          @click="emit('tab-change', 'course')"
        >
          课程统计
        </button>
      </div>

      <label class="mc-row toolbar__pick">
        <span class="mc-label">课程</span>
        <select v-model="courseModel" class="mc-select" aria-label="选择课程">
          <option value="">请选择课程</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>

      <label v-if="tab === 'lesson'" class="mc-row toolbar__pick">
        <span class="mc-label">课时</span>
        <select v-model="lessonModel" class="mc-select" aria-label="选择课时" :disabled="lessonsLoading">
          <option value="">请选择课时</option>
          <option v-for="l in lessons" :key="l.id" :value="l.id">{{ l.title }}</option>
        </select>
      </label>
    </template>
  </Toolbar>
</template>

<style scoped>
/* 工具栏留白比默认工具栏更大（与拆分前父页面的覆盖规则一致） */
.toolbar {
  padding: var(--mc-space-4) var(--mc-space-5);
}

.tabs {
  display: inline-flex;
  gap: var(--mc-space-2);
}

.toolbar__pick {
  gap: var(--mc-space-2);
}
</style>
