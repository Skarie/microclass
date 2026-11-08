<script setup lang="ts">
/**
 * 平铺卡片封面：设计封面（或真图）+ 中性分类角标 + 状态徽标。
 * 角标不抢构图：统一中性底，状态只在 6px 圆点上用语义色。
 */
import { computed } from 'vue';
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
  <div class="cover">
    <CourseCoverArt class="cover__art" :course="course" />
    <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
    <CourseCoverTag :label="STATUS_LABEL[status]" corner="right" :tone="statusTone" dot />
  </div>
</template>

<style scoped>
/* 封面本身不是可点元素：整张卡由标题上的「拉伸链接」接管（见 HallCourseCard） */
.cover {
  position: relative;
  display: block;
  height: 148px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md) var(--mc-radius-md) 0 0;
}

.cover__art {
  transition: transform var(--mc-duration) var(--mc-ease-out);
}
</style>
