<script setup lang="ts">
import Toolbar from '@/components/Toolbar.vue';
import type { CourseOption } from './analytics-types';

/**
 * 范围筛选条：课程 / 时间范围 / 统计时间（缓存 1 分钟提示）。
 * 只发事件，不改 props；筛选与重新加载由页面编排。
 */
defineProps<{ courses: CourseOption[]; courseId: number | ''; days: number; generatedAt: number | null }>();
const emit = defineEmits<{ courseChange: [id: number | '']; daysChange: [days: number] }>();

function onCourse(e: Event): void {
  const value = (e.target as HTMLSelectElement).value;
  emit('courseChange', value === '' ? '' : Number(value));
}

function onDays(e: Event): void {
  emit('daysChange', Number((e.target as HTMLSelectElement).value));
}
</script>

<template>
  <Toolbar>
    <label class="ana__field">
      <span class="mc-label">课程</span>
      <select class="mc-select" :value="courseId" aria-label="选择课程" @change="onCourse">
        <option value="">全部课程（机构视角）</option>
        <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </label>
    <label class="ana__field">
      <span class="mc-label">时间范围</span>
      <select class="mc-select" :value="days" aria-label="时间范围" @change="onDays">
        <option :value="7">最近 7 天</option>
        <option :value="30">最近 30 天</option>
        <option :value="90">最近 90 天</option>
        <option :value="0">全部历史</option>
      </select>
    </label>
    <span class="mc-spacer" />
    <span v-if="generatedAt !== null" class="mc-muted ana__stamp">
      统计于 {{ new Date(generatedAt).toLocaleTimeString('zh-CN') }}（缓存 1 分钟）
    </span>
  </Toolbar>
</template>

<style scoped>
.ana__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
}

.ana__stamp {
  font-size: var(--mc-text-xs);
}
</style>
