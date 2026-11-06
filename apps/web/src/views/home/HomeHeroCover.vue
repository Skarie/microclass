<script setup lang="ts">
/**
 * 首页 hero 的课程封面：有图用真实封面，无图用分类 tint + 图标。
 * 角标用半透明白底保证图片上的可读性；图片加载失败时退回 tint。
 */
import { ref, watch } from 'vue';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import { COVER_HERO_WIDTH, coverUrl } from '@/utils/course-cover';
import { tintVars } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course }>();
const failed = ref(false);
watch(
  () => props.course.id,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div class="hero-cover" :style="tintVars(course)">
    <img
      v-if="course.cover && !failed"
      :src="coverUrl(course.id, COVER_HERO_WIDTH)"
      :alt="course.name"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <span v-else class="hero-cover__fallback" aria-hidden="true">
      <Icon name="graduation" :size="44" />
    </span>
    <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
  </div>
</template>

<style scoped>
.hero-cover {
  position: relative;
  height: 180px;
  overflow: hidden;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background-color: var(--cover-tint);
  background-image: var(--mc-cover-pattern);
  color: var(--cover-ink);
}

.hero-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-cover__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

@media (max-width: 900px) {
  .hero-cover {
    height: 160px;
  }
}
</style>
