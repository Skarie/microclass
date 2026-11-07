<script setup lang="ts">
/**
 * 课程大厅 · 欢迎条：主色实底 + 白字 + 白色主按钮 / 描边次按钮，右侧几何装饰。
 * 文案只讲真实状态：上次在学什么、共有多少门课。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import GeoArt from '@/components/GeoArt.vue';
import Icon from '@/components/Icon.vue';
import type { HallCatalog } from '@/composables/use-hall-catalog';

const props = defineProps<{ catalog: HallCatalog }>();

const course = computed(() => props.catalog.continueCourse);
const continueTo = computed(() =>
  course.value ? { name: 'course', params: { id: course.value.id } } : { name: 'hall', hash: '#hall-list' },
);
</script>

<template>
  <section class="welcome" aria-label="课程大厅引导">
    <GeoArt class="welcome__art" />

    <div class="welcome__text">
      <p class="welcome__eyebrow">
        <Icon name="hall" :size="14" />
        课程大厅
      </p>
      <p v-if="course" class="welcome__line">
        上次在学 <strong>{{ course.name }}</strong
        >，已完成 <span class="mc-num">{{ course.finished ?? 0 }}/{{ course.total ?? 0 }}</span> 课时。
      </p>
      <p v-else class="welcome__line">还没有在学的课程，从下面挑一门开始；学完第一节课后会自动出现在首页。</p>
      <p class="welcome__hint">
        共 <strong class="mc-num">{{ catalog.courses.length }}</strong> 门课程，按分类整理；也可以直接搜索课程名或简介。
      </p>
    </div>

    <div class="welcome__actions">
      <RouterLink class="welcome__cta" :to="continueTo">
        <Icon name="play" :size="14" />
        {{ course ? '继续上次学习' : '开始第一门课' }}
      </RouterLink>
      <RouterLink class="welcome__browse" :to="{ name: 'hall', hash: '#hall-list' }" @click="catalog.resetFilters()">
        浏览全部课程
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.welcome {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-5);
  overflow: hidden;
  padding: var(--mc-space-6);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-hero-bg);
  color: var(--mc-hero-fg);
}

.welcome__text {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 360px;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.welcome__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0 0 var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0.08em;
}

.welcome__line {
  margin: 0;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-medium);
  line-height: var(--mc-leading-snug);
}

.welcome__line strong {
  font-weight: var(--mc-font-semibold);
}

.welcome__hint {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-hero-muted);
}

.welcome__actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex: none;
}

.welcome__cta,
.welcome__browse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-2);
  min-height: var(--mc-control-h-lg);
  padding: 0 var(--mc-space-4);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  white-space: nowrap;
  transition: var(--mc-transition-colors);
}

.welcome__cta {
  border: 1px solid var(--mc-hero-fg);
  background: var(--mc-hero-fg);
  color: var(--mc-player-bg);
}

.welcome__cta:hover {
  background: var(--mc-hero-muted);
}

.welcome__browse {
  border: 1px solid color-mix(in srgb, var(--mc-hero-fg) 62%, transparent);
  color: var(--mc-hero-fg);
}

.welcome__browse:hover {
  border-color: var(--mc-hero-fg);
  background: color-mix(in srgb, var(--mc-hero-fg) 12%, transparent);
}

.welcome__cta:focus-visible,
.welcome__browse:focus-visible {
  outline: 2px solid var(--mc-hero-fg);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .welcome {
    align-items: flex-start;
    padding: var(--mc-space-5);
  }

  .welcome__actions {
    width: 100%;
    flex-wrap: wrap;
  }
}

@media (max-width: 1023px) {
  .welcome__cta,
  .welcome__browse {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
