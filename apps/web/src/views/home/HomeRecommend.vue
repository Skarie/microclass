<script setup lang="ts">
/**
 * 首页 · 推荐课程：3 张卡片（同类优先、新上线其次）。
 *
 * 数据由首页看板在 `/courses` 上派生（utils/course-recommend），这里只负责摆放；
 * 没有可推荐的课程时整块不渲染，不拿「暂无」占版面。
 */
import HomeRecommendCard from './HomeRecommendCard.vue';
import SectionHead from '@/components/SectionHead.vue';
import type { Recommendation } from '@/utils/course-recommend';

defineProps<{ items: Recommendation[] }>();
</script>

<template>
  <section v-if="items.length > 0" class="rec mc-fade-in" aria-label="推荐课程">
    <SectionHead title="推荐课程">
      <template #meta>同类优先 · 新上线其次</template>
    </SectionHead>

    <ul class="rec__list">
      <HomeRecommendCard v-for="item in items" :key="item.course.id" :recommendation="item" />
    </ul>
  </section>
</template>

<style scoped>
.rec__list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--mc-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 900px) {
  .rec__list {
    grid-template-columns: 1fr;
  }
}
</style>
