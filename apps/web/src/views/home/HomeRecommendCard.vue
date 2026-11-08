<script setup lang="ts">
/**
 * 推荐课程卡：封面 + 推荐理由标签 + 名称 / 简介 / 课时 + 实心主色入口。
 * 不做大号水印序号：卡片只表达推荐理由与课程事实。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import { REASON_LABEL, REASON_TONE, type Recommendation } from '@/utils/course-recommend';

const props = defineProps<{ recommendation: Recommendation }>();
const course = computed(() => props.recommendation.course);
</script>

<template>
  <li class="rec-card mc-card">
    <div class="rec-card__cover">
      <CourseCoverArt :course="course" />
      <span class="rec-card__reason">
        <Tag :tone="REASON_TONE[recommendation.reason]" size="sm">{{ REASON_LABEL[recommendation.reason] }}</Tag>
      </span>
    </div>

    <div class="rec-card__body">
      <RouterLink class="rec-card__name" :to="{ name: 'course', params: { id: course.id } }">
        <span class="rec-card__name-text">{{ course.name }}</span>
      </RouterLink>

      <p v-if="course.description" class="rec-card__desc">{{ course.description }}</p>

      <div class="rec-card__foot">
        <span class="rec-card__meta mc-num">{{ course.total ?? 0 }} 课时</span>
        <RouterLink class="rec-card__cta" :to="{ name: 'course', params: { id: course.id } }">
          查看课程
          <Icon name="arrow-right" :size="14" />
        </RouterLink>
      </div>
    </div>
  </li>
</template>

<style scoped>
.rec-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .rec-card:hover {
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }

  .rec-card:hover :deep(.art) {
    transform: scale(1.03);
  }
}

.rec-card:focus-within {
  border-color: var(--mc-primary-border);
  box-shadow: var(--mc-shadow-xs);
  transform: translateY(var(--mc-hover-lift));
}

.rec-card:active {
  box-shadow: none;
  transform: scale(var(--mc-press-scale-soft));
}

.rec-card__cover {
  position: relative;
  display: block;
  height: 148px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
}

.rec-card__cover :deep(.art) {
  transition: transform var(--mc-duration) var(--mc-ease-out);
}

.rec-card__reason {
  position: absolute;
  top: var(--mc-space-2);
  right: var(--mc-space-2);
  z-index: 1;
  display: inline-flex;
}

.rec-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4);
  min-width: 0;
}

.rec-card__name {
  display: block;
  min-height: calc(var(--mc-text-base) * var(--mc-leading) * 2);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading);
  color: var(--mc-text);
}

.rec-card__name-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* 拉伸链接：整卡可点，标题即入口 */
.rec-card__name::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
}

.rec-card__name:hover,
.rec-card__name:focus-visible {
  color: var(--mc-primary-fg);
}

.rec-card__desc {
  margin: 0;
  overflow: hidden;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
  margin-top: auto;
  padding-top: var(--mc-space-1);
}

.rec-card__meta {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.rec-card__cta {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 32px;
  padding: 0 var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  transition: var(--mc-transition-all);
}

.rec-card__cta:hover {
  background: var(--mc-primary-deep);
}

.rec-card__cta:active {
  transform: scale(var(--mc-press-scale));
}

@media (max-width: 1023px) {
  .rec-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
