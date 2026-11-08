<script setup lang="ts">
/**
 * 首页 · 继续学习 Hero：整块主色底（纯色），左侧白字 + 白色主按钮 / 描边次按钮，
 * 右侧单色几何装饰（GeoArt）。不用图片、不用渐变，层级靠字号与留白。
 */
import { RouterLink } from 'vue-router';
import GeoArt from '@/components/GeoArt.vue';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import type { Course } from '@/api/types';

defineProps<{ course: Course | null; progress: number }>();
</script>

<template>
  <section class="hero" aria-label="继续学习">
    <GeoArt class="hero__art" />

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

        <div class="hero__actions">
          <RouterLink class="hero__cta" :to="{ name: 'course', params: { id: course.id } }">
            继续学习
            <Icon name="arrow-right" :size="15" />
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
            <Icon name="arrow-right" :size="15" />
          </RouterLink>
          <RouterLink class="hero__ghost" :to="{ name: 'my-courses' }">查看我的课程</RouterLink>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  padding: var(--mc-space-10);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-hero-bg);
  color: var(--mc-hero-fg);
}

.hero__main {
  position: relative;
  z-index: 1;
  display: flex;
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

.hero__progress {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  width: 100%;
  max-width: 440px;
  margin-top: var(--mc-space-2);
}

.hero__progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-xs);
  color: var(--mc-hero-fg);
}

.hero__percent {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
}

/* 进度条落在主色底上：轨道 / 填充改成白色系（只在本组件穿透一次） */
.hero :deep(.pb__track) {
  background: color-mix(in srgb, var(--mc-hero-fg) 24%, transparent);
}

.hero :deep(.pb__bar) {
  background: var(--mc-hero-fg);
}

.hero :deep(.pb__end) {
  background: var(--mc-hero-fg);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-3);
  margin-top: var(--mc-space-3);
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
