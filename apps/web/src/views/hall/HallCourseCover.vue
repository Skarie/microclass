<script setup lang="ts">
/**
 * 平铺卡片的封面：真实封面图 / 分类 tint 兜底，左上分类 chip、右上状态徽标。
 * 角标统一用 CourseCoverTag 的半透明白底，保证图片上的可读性。
 */
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import { COVER_CARD_WIDTH, coverUrl } from '@/utils/course-cover';
import { STATUS_LABEL, statusOf, tintVars } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course }>();

const status = computed(() => statusOf(props.course));
const statusTone = computed(() =>
  status.value === 'learning' ? 'primary' : status.value === 'finished' ? 'success' : 'neutral',
);
const failed = ref(false);
watch(
  () => props.course.id,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <RouterLink
    class="cover"
    :style="tintVars(course)"
    :to="{ name: 'course', params: { id: course.id } }"
    tabindex="-1"
    :aria-label="`进入课程 ${course.name}`"
  >
    <img
      v-if="course.cover && !failed"
      :src="coverUrl(course.id, COVER_CARD_WIDTH)"
      :alt="course.name"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <span v-else class="cover__fallback" aria-hidden="true">
      <Icon name="graduation" :size="32" />
    </span>
    <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
    <CourseCoverTag :label="STATUS_LABEL[status]" corner="right" :tone="statusTone" dot />
  </RouterLink>
</template>

<style scoped>
.cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 144px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md) var(--mc-radius-md) 0 0;
  background-color: var(--cover-tint);
  background-image: var(--mc-cover-pattern);
  color: var(--cover-ink);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
</style>
