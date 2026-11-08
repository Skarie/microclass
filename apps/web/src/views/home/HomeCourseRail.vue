<script setup lang="ts">
/**
 * 首页 · 我的课程：横向卡列（最多 5 门），滚动条隐藏，右侧「全部课程」。
 */
import HomeCourseRailCard from './HomeCourseRailCard.vue';
import SectionHead from '@/components/SectionHead.vue';
import type { Course } from '@/api/types';

defineProps<{ courses: Course[]; progressOf: (course: Course) => number }>();
</script>

<template>
  <section v-if="courses.length > 0" class="rail" aria-label="我的课程">
    <SectionHead title="我的课程" action-text="全部课程" action-to="/my-courses">
      <template #meta>{{ courses.length }} 门</template>
    </SectionHead>

    <div class="rail__scroll">
      <ul class="rail__list">
        <HomeCourseRailCard
          v-for="course in courses"
          :key="course.id"
          :course="course"
          :progress="progressOf(course)"
        />
      </ul>
    </div>
  </section>
</template>

<style scoped>
.rail__scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding: var(--mc-space-1);
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}

.rail__scroll::-webkit-scrollbar {
  display: none;
}

.rail__list {
  display: flex;
  gap: var(--mc-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
