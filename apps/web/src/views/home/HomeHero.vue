<script setup lang="ts">
/**
 * 首页 · 继续学习 hero：最近在学的一门课 + 进度 + 全页唯一的橙色 CTA。
 * 课程来自 `/courses`；接口没有访问时间，所以取在学课程里进度最高的一门。
 */
import { RouterLink } from 'vue-router';
import HomeHeroCover from './HomeHeroCover.vue';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course | null; progress: number }>();
</script>

<template>
  <section class="hero" aria-label="继续学习">
    <div class="hero__main">
      <p class="hero__eyebrow">
        <Icon name="play" :size="14" />
        {{ course ? '继续学习' : '开始学习' }}
      </p>

      <template v-if="course">
        <h2 class="hero__title">{{ course.name }}</h2>
        <p v-if="course.description" class="hero__desc">{{ course.description }}</p>

        <div class="hero__progress">
          <div class="hero__progress-head">
            <span>
              已学完 <strong class="mc-num">{{ course.finished ?? 0 }}</strong> / {{ course.total ?? 0 }} 课时
            </span>
            <span class="hero__percent mc-num">{{ progress }}%</span>
          </div>
          <ProgressBar :value="progress" tone="primary" :show-end="false" :aria-label="`${course.name} 学习进度`" />
        </div>

        <RouterLink class="hero__cta" :to="{ name: 'course', params: { id: course.id } }">
          <Icon name="play" :size="15" />
          继续学习
          <Icon class="hero__cta-arrow" name="arrow-right" :size="15" />
        </RouterLink>
      </template>

      <template v-else>
        <h2 class="hero__title">还没有在学的课程</h2>
        <p class="hero__desc">从课程大厅挑一门课开始；学完第一节课后，这里会显示你的进度。</p>
        <RouterLink class="mc-btn mc-btn--primary hero__browse" :to="{ name: 'hall' }">
          <Icon name="hall" :size="15" />
          去课程大厅
        </RouterLink>
      </template>
    </div>

    <HomeHeroCover v-if="course" :course="course" />

    <span v-else class="hero__empty-art" aria-hidden="true">
      <Icon name="graduation" :size="48" />
    </span>
  </section>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: center;
  gap: var(--mc-space-6);
  padding: var(--mc-space-6);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-primary-soft);
}

.hero__main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mc-space-2);
  min-width: 0;
}

.hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0.06em;
  color: var(--mc-primary-fg);
}

.hero__title {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.hero__desc {
  display: -webkit-box;
  margin: 0;
  max-width: 68ch;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-text-secondary);
}

.hero__progress {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  width: 100%;
  max-width: 420px;
  margin-top: var(--mc-space-1);
}

.hero__progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.hero__percent {
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
}

/* 全页唯一橙色 CTA：其余按钮保持主色或中性 */
.hero__cta {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-height: var(--mc-control-h-lg);
  margin-top: var(--mc-space-2);
  padding: 0 var(--mc-space-5);
  border: 1px solid var(--mc-accent-fg);
  border-radius: var(--mc-radius);
  background: var(--mc-accent-fg);
  color: var(--mc-text-inverse);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  transition: var(--mc-transition-colors);
}

.hero__cta:hover {
  border-color: var(--mc-accent-hover);
  background: var(--mc-accent-hover);
  box-shadow: var(--mc-shadow-accent);
}

.hero__cta:active {
  border-color: var(--mc-accent-fg);
  background: var(--mc-accent-fg);
  box-shadow: none;
}

.hero__cta:focus-visible {
  outline: none;
  box-shadow: var(--mc-focus-ring);
}

.hero__empty-art {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .hero__empty-art {
    display: none;
  }
}

@media (max-width: 1023px) {
  .hero__cta {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
