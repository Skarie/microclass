<script setup lang="ts">
/**
 * 首页 · 最近在学：取进度最快的前 3 门在学课程，直接继续。
 * 每行是独立组件（含自己的样式），这里只管标题与列表容器。
 */
import HomeRecentRow from './HomeRecentRow.vue';
import type { Course } from '@/api/types';

defineProps<{ courses: Course[]; progressOf: (course: Course) => number }>();
</script>

<template>
  <section v-if="courses.length > 0" class="recent">
    <ul class="recent__list">
      <HomeRecentRow
        v-for="course in courses.slice(0, 3)"
        :key="course.id"
        :course="course"
        :progress="progressOf(course)"
      />
    </ul>
  </section>
</template>

<style scoped>
.recent__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
