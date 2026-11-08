<script setup lang="ts">
/**
 * 首页 Hero 右侧：有封面就显示封面，没有就用课程名首字。
 * 只是课程身份的可视化，不带任何装饰图形。
 */
import { computed } from 'vue';
import { COVER_HERO_WIDTH, coverUrl } from '@/utils/course-cover';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course }>();
const initial = computed(() => (props.course.name || '课').trim().slice(0, 1).toUpperCase());
</script>

<template>
  <div class="hero-aside" aria-hidden="true">
    <img
      v-if="course.cover"
      class="hero-aside__cover"
      :src="coverUrl(course.id, COVER_HERO_WIDTH)"
      alt=""
      loading="eager"
    />
    <span v-else class="hero-aside__initial">{{ initial }}</span>
  </div>
</template>

<style scoped>
.hero-aside {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 300px;
  max-width: 30%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mc-hero-fg) 24%, transparent);
  border-radius: var(--mc-radius-md);
}

.hero-aside__cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-aside__initial {
  font-size: var(--mc-text-4xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-cn);
  color: var(--mc-hero-fg);
  opacity: 0.9;
}

@media (max-width: 900px) {
  .hero-aside {
    display: none;
  }
}
</style>
