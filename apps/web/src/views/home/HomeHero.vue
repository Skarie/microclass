<script setup lang="ts">
/**
 * 首页 · 继续学习 Hero：纯主色块 + 白字 + 按钮。
 * 右侧只放有信息含义的课程封面；没有封面时用课程名首字，不做装饰图形。
 */
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import HomeHeroAside from './HomeHeroAside.vue';
import HomeHeroProgress from './HomeHeroProgress.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course | null; progress: number; loading?: boolean }>();
</script>

<template>
  <section class="hero" aria-label="继续学习">
    <div class="hero__main">
      <p class="hero__eyebrow">
        <Icon name="play" :size="14" />
        {{ course ? '继续学习' : '开始学习' }}
      </p>

      <!-- 首屏取数中：给骨架而不是「还没有在学的课程」——空状态不能当加载态用 -->
      <div v-if="loading && !course" class="hero__skeleton" aria-hidden="true">
        <div class="mc-skeleton hero__skeleton-line hero__skeleton-line--title" />
        <div class="mc-skeleton hero__skeleton-line" />
        <div class="mc-skeleton hero__skeleton-bar" />
      </div>

      <template v-else-if="course">
        <h2 class="hero__title">{{ course.name }}</h2>
        <p v-if="course.description" class="hero__desc">{{ course.description }}</p>

        <HomeHeroProgress :course="course" :progress="progress" />

        <div class="hero__actions">
          <RouterLink class="hero__cta" :to="{ name: 'course', params: { id: course.id } }">
            继续学习
            <Icon name="arrow-right" :size="16" />
          </RouterLink>
          <RouterLink class="hero__ghost" :to="{ name: 'hall' }">浏览课程大厅</RouterLink>
        </div>
      </template>

      <template v-else>
        <h2 class="hero__title">还没有在学的课程</h2>
        <p class="hero__desc">去课程大厅选一门，从第一课时开始。</p>
        <div class="hero__actions">
          <RouterLink class="hero__cta" :to="{ name: 'hall' }">
            去课程大厅
            <Icon name="arrow-right" :size="16" />
          </RouterLink>
          <RouterLink class="hero__ghost" :to="{ name: 'my-courses' }">查看我的课程</RouterLink>
        </div>
      </template>
    </div>

    <HomeHeroAside v-if="course" :course="course" />
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-8);
  overflow: hidden;
  padding: var(--mc-space-10);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-hero-bg);
  color: var(--mc-hero-fg);
}

.hero__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mc-space-3);
  max-width: 640px;
  min-width: 0;
}

.hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0.08em;
  color: var(--mc-hero-fg);
}

.hero__title {
  margin: 0;
  font-size: var(--mc-text-4xl);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-cn);
  color: var(--mc-hero-fg);
  text-wrap: balance;
}

.hero__desc {
  display: -webkit-box;
  max-width: 56ch;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-hero-muted);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-3);
  margin-top: var(--mc-space-3);
}

/* 加载骨架：与标题/简介/进度条的占位高度一致，数据回来不跳动 */
.hero__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  width: 100%;
  margin-top: var(--mc-space-1);
}

.hero__skeleton-line {
  height: 16px;
  max-width: 420px;
}

.hero__skeleton-line--title {
  height: 32px;
  max-width: 320px;
}

.hero__skeleton-bar {
  height: 8px;
  max-width: 260px;
  border-radius: var(--mc-radius-pill);
}

.hero__cta,
.hero__ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-2);
  min-height: var(--mc-control-h-lg);
  padding: 0 var(--mc-space-5);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  transition: var(--mc-transition-colors);
}

.hero__cta {
  border: 1px solid var(--mc-hero-fg);
  background: var(--mc-hero-fg);
  color: var(--mc-player-bg);
}

.hero__cta:hover {
  background: var(--mc-hero-muted);
}

.hero__ghost {
  border: 1px solid color-mix(in srgb, var(--mc-hero-fg) 62%, transparent);
  background: transparent;
  color: var(--mc-hero-fg);
}

.hero__ghost:hover {
  border-color: var(--mc-hero-fg);
  background: color-mix(in srgb, var(--mc-hero-fg) 12%, transparent);
}

.hero__cta:focus-visible,
.hero__ghost:focus-visible {
  outline: 2px solid var(--mc-hero-fg);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .hero {
    padding: var(--mc-space-6);
  }

  .hero__title {
    font-size: var(--mc-text-2xl);
  }
}

@media (max-width: 1023px) {
  .hero__cta,
  .hero__ghost {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
