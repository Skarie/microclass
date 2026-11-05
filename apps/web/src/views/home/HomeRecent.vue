<script setup lang="ts">
/**
 * 首页 · 最近在学：取进度最快的前 3 门在学课程，直接继续。
 * 每行是独立组件（含自己的样式），这里只管标题与列表容器。
 */
import { RouterLink } from 'vue-router';
import HomeRecentRow from './HomeRecentRow.vue';
import type { Course } from '@/api/types';

defineProps<{ courses: Course[]; progressOf: (course: Course) => number }>();
</script>

<template>
  <section v-if="courses.length > 0" class="recent">
    <header class="recent__head">
      <h2 class="recent__title">最近在学</h2>
      <RouterLink class="mc-link recent__more" :to="{ name: 'my-courses' }">我的课程 →</RouterLink>
    </header>
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
.recent__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
}

.recent__title {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.recent__more {
  font-size: var(--mc-text-xs);
}

.recent__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 640px) {
  /* 移动端「最近学习 ›」点击高度不足 */
  .recent__more {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }
}
</style>
