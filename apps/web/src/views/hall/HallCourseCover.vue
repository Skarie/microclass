<script setup lang="ts">
/**
 * 平铺卡片封面：统一主色封面 + 中性分类角标 + 状态徽标。
 * 真实封面图不参与构图，同页所有封面保持一个系统。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import { STATUS_LABEL, statusOf } from '@/utils/course-meta';
import type { Course } from '@/api/types';

const props = defineProps<{ course: Course }>();

const status = computed(() => statusOf(props.course));
const statusTone = computed(() =>
  status.value === 'learning' ? 'primary' : status.value === 'finished' ? 'success' : 'neutral',
);
</script>

<template>
  <RouterLink
    class="cover"
    :to="{ name: 'course', params: { id: course.id } }"
    tabindex="-1"
    :aria-label="`进入课程 ${course.name}`"
  >
    <CourseCoverArt class="cover__art" :course="course" />
    <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
    <CourseCoverTag :label="STATUS_LABEL[status]" corner="right" :tone="statusTone" dot />
  </RouterLink>
</template>

<style scoped>
.cover {
  position: relative;
  display: block;
  height: 148px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md) var(--mc-radius-md) 0 0;
}
</style>
