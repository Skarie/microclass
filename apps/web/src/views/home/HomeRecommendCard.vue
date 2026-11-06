<script setup lang="ts">
/**
 * 推荐课程卡：封面（缩略图 400）+ 推荐理由小标签 + 名称/简介/课时 + 查看课程。
 *
 * 沿用大厅卡片的视觉（同样的封面高、角标、圆角与 hover 抬升），
 * 差别只在右上角换成「同类课程 / 新上线」的理由标签，并且不做收藏按钮（推荐位不做二次操作）。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import CourseCoverTag from '@/components/CourseCoverTag.vue';
import Icon from '@/components/Icon.vue';
import Tag from '@/components/Tag.vue';
import { COVER_CARD_WIDTH, coverUrl } from '@/utils/course-cover';
import { tintVars } from '@/utils/course-meta';
import { REASON_LABEL, REASON_TONE, type Recommendation } from '@/utils/course-recommend';

const props = defineProps<{ recommendation: Recommendation }>();
const course = computed(() => props.recommendation.course);
</script>

<template>
  <li class="rec-card mc-card">
    <RouterLink
      class="rec-card__cover"
      :style="tintVars(course)"
      :to="{ name: 'course', params: { id: course.id } }"
      tabindex="-1"
      :aria-label="`进入课程 ${course.name}`"
    >
      <img
        v-if="course.cover"
        :src="coverUrl(course.id, COVER_CARD_WIDTH)"
        :alt="course.name"
        loading="lazy"
        decoding="async"
      />
      <Icon v-else name="graduation" :size="32" />
      <CourseCoverTag v-if="course.category_name" :label="course.category_name" corner="left" />
      <span class="rec-card__reason">
        <Tag :tone="REASON_TONE[recommendation.reason]" size="sm">{{ REASON_LABEL[recommendation.reason] }}</Tag>
      </span>
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
  display: flex;
  align-items: center;
  justify-content: center;
  height: 132px;
  overflow: hidden;
  border-bottom: 1px solid var(--mc-border);
  background-color: var(--cover-tint);
  background-image: var(--mc-cover-pattern);
  color: var(--cover-ink);
}

.rec-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  transition: var(--mc-transition-colors);
}

.rec-card__cta:hover {
  border-color: var(--mc-primary);
}

@media (max-width: 1023px) {
  .rec-card__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
