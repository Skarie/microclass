<script setup lang="ts">
/**
 * 平铺卡片封面：设计封面（或真图）+ 右上状态徽标。
 * 分类已经印在封面里（左上小标签），这里不再叠一个角标 —— 同一信息出现两次只会显脏；
 * 状态只在 6px 圆点上用语义色，文字本身始终可读。
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
