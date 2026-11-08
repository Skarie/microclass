<script setup lang="ts">
/**
 * 课程封面：封面是「内容图像」，不是装饰。有真封面就用真图，没有就生成设计封面。
 *
 * 生成规则固定、可预期，不做随机（随机会让同一门课在首页和大厅变成两个样）：
 *   ① 底色 = 分类名 hash 到三色盘之一（深主绿 / 炭灰 / 赭石），同分类同色，全站只有 3 种；
 *   ② 右侧一组固定几何：2px 描边圆 + 实心圆 + 两道 45° 斜线（白色 30%~34%）；
 *   ③ 左下固定文字块：课程名首字（大号白色 600）+ 课程名（小号白色 76%，最多 2 行）。
 *
 * 列表里的 40×40 缩略图不参与构图：中性块 + 首字。一列里排十几个色块只会更吵。
 */
import { computed, ref, watch } from 'vue';
import { COVER_CARD_WIDTH, COVER_HERO_WIDTH, coverUrl } from '@/utils/course-cover';
import { coverInitial, coverToneForCategory } from '@/utils/course-meta';
import type { Course } from '@/api/types';

type CoverVariant = 'card' | 'row' | 'hero';

const props = withDefaults(defineProps<{ course: Course; variant?: CoverVariant }>(), { variant: 'card' });

/** 真图 404 / 解码失败时回落到设计封面，不留一个破图占位 */
const broken = ref(false);
watch(
  () => props.course.id,
  () => {
    broken.value = false;
  },
);

const hasImage = computed(() => Boolean(props.course.cover) && !broken.value);
const isHero = computed(() => props.variant === 'hero');
const isRow = computed(() => props.variant === 'row');
const src = computed(() => coverUrl(props.course.id, isHero.value ? COVER_HERO_WIDTH : COVER_CARD_WIDTH));
const tone = computed(() => coverToneForCategory(props.course.category_name));
const initial = computed(() => coverInitial(props.course.name));
</script>

<template>
  <div class="art" :class="`art--${variant}`" :data-tone="tone">
    <img
      v-if="hasImage"
      class="art__img"
      :src="src"
      alt=""
      :loading="isHero ? 'eager' : 'lazy'"
      decoding="async"
      @error="broken = true"
    />

    <span v-else-if="isRow" class="art__row-initial" aria-hidden="true">{{ initial }}</span>

    <template v-else>
      <!-- 几何装饰：一个正方形 SVG 贴右下角，随封面高度等比缩放，不会随宽度被拉扁 -->
      <svg class="art__deco" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle class="art__ring" cx="116" cy="62" r="46" />
        <circle class="art__dot" cx="74" cy="74" r="8" />
        <path class="art__lines" d="M54 120 100 74M82 120 120 82" />
      </svg>

      <span class="art__text">
        <span class="art__initial" aria-hidden="true">{{ initial }}</span>
        <span v-if="isHero" class="art__name">{{ course.name }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.art {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--mc-bg-sunken);
  color: var(--mc-cover-fg);
}

/* 三色盘：底色只由分类决定，暗色主题也不换（封面是图像，不该跟着主题走） */
.art[data-tone='green'] {
  background: var(--mc-cover-green);
}

.art[data-tone='charcoal'] {
  background: var(--mc-cover-charcoal);
}

.art[data-tone='ochre'] {
  background: var(--mc-cover-ochre);
}

.art__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ---------- 设计封面：几何 ---------- */
.art__deco {
  position: absolute;
  right: 0;
  bottom: 0;
  height: 92%;
  aspect-ratio: 1;
  transform: translateX(14%);
  overflow: visible;
  pointer-events: none;
}

.art__ring {
  fill: none;
  stroke: var(--mc-cover-line);
  stroke-width: 2;
}

.art__dot {
  fill: var(--mc-cover-line-strong);
}

.art__lines {
  fill: none;
  stroke: var(--mc-cover-line-strong);
  stroke-width: 2;
  stroke-linecap: round;
}

/* ---------- 设计封面：文字块 ---------- */
.art__text {
  position: absolute;
  bottom: var(--mc-space-3);
  left: var(--mc-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  max-width: 66%;
  min-width: 0;
}

.art__initial {
  font-size: var(--mc-text-4xl);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
  letter-spacing: var(--mc-tracking-cn);
}

.art__name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-cover-name);
}

.art--hero .art__text {
  bottom: var(--mc-space-4);
  left: var(--mc-space-5);
  max-width: 64%;
}

.art--hero .art__initial {
  font-size: var(--mc-text-4xl);
}

.art--hero .art__name {
  font-size: var(--mc-text-sm);
}

/* ---------- 列表缩略图：中性块 + 首字 ---------- */
.art.art--row {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
}

.art__row-initial {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
}
</style>
