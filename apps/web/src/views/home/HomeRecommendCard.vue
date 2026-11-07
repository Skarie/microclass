<script setup lang="ts">
/**
 * 推荐课程卡：分类色块 + 几何封面 + 白色大水印序号（01/02/03）+
 * 推荐理由标签 + 名称 / 简介 / 课时 + 实心主色入口。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverArt from '@/components/CourseCoverArt.vue';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import { REASON_LABEL, REASON_TONE, type Recommendation } from '@/utils/course-recommend';

const props = defineProps<{ recommendation: Recommendation; index: number }>();
const course = computed(() => props.recommendation.course);
const order = computed(() => String(props.index + 1).padStart(2, '0'));
</script>

<template>
  <li class="rec-card mc-card">
    <RouterLink
      class="rec-card__cover"
      :to="{ name: 'course', params: { id: course.id } }"
      tabindex="-1"
      :aria-label="`进入课程 ${course.name}`"
    >
      <CourseCoverArt :course="course" />
      <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
      <span class="rec-card__reason">
        <Tag :tone="REASON_TONE[recommendation.reason]" size="sm">{{ REASON_LABEL[recommendation.reason] }}</Tag>
      </span>
      <span class="rec-card__order" aria-hidden="true">{{ order }}</span>
    </RouterLink>

    <div class="rec-card__body">
      <RouterLink class="rec-card__name" :to="{ name: 'course', params: { id: course.id } }">
        {{ course.name }}
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .rec-card:hover {
    border-color: var(--mc-primary);
    box-shadow: var(--mc-shadow-xs);
    transform: translateY(var(--mc-hover-lift));
  }
}

.rec-card__cover {
  position: relative;
  display: block;
  height: 148px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
}

.rec-card__reason {
  position: absolute;
  top: var(--mc-space-2);
  right: var(--mc-space-2);
  z-index: 1;
  display: inline-flex;
}

/* 编辑部式序号：34 档放大 1.4 倍到 48 视觉，不新增字号档位 */
.rec-card__order {
  position: absolute;
  right: var(--mc-space-3);
  bottom: 0;
  color: var(--mc-hero-fg);
  font-size: calc(var(--mc-text-4xl) * 1.4);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  opacity: 0.26;
  pointer-events: none;
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
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  min-height: calc(var(--mc-text-base) * var(--mc-leading) * 2);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading);
  color: var(--mc-text);
}

.rec-card__name:hover {
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
  transition: var(--mc-transition-colors);
}

.rec-card__cta:hover {
  background: var(--mc-primary-hover);
}

@media (max-width: 1023px) {
  .rec-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
