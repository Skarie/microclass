<script setup lang="ts">
/**
 * 课程封面：封面是「图像」，不是装饰。有真封面就用真图，没有就生成编辑式封面。
 *
 * 生成规则固定、可预期，不做随机（随机会让同一门课在首页和大厅变成两个样）：
 *   ① 纸底 = 分类名 hash 到三色盘之一（雾绿 / 石白 / 沙色），同分类同色，全站只有 3 种；
 *   ② 左上分类小标签、右下一条 14% 的细线；只有 Hero 这一种「像书封」的用法才印课程名；
 *   ③ 只有排版和留白 —— 没有大字首字、没有实色块、没有彩色几何。
 *
 * 为什么卡片不印课程名：卡体标题就在封面正下方，同一串字上下相邻出现两次是最刺眼的重复
 * （自查清单第 3 条）。封面上只放卡体没有的信息（分类），课程名交给标题。
 * 列表里的 40×40 缩略图同样不参与构图：中性块 + 首字。一列里排十几个色块只会更吵。
 */
import { computed, ref, watch } from 'vue';
import { COVER_CARD_WIDTH, COVER_HERO_WIDTH, coverUrl } from '@/utils/course-cover';
import { coverInitial, coverToneForCategory } from '@/utils/course-meta';
import type { Course } from '@/api/types';

type CoverVariant = 'card' | 'row' | 'hero';

const props = withDefaults(
  defineProps<{
    course: Course;
    variant?: CoverVariant;
    /** 次级的次级信息（如「30 课时」）：调用方传入；调用方自己已经显示过就别传，避免重复 */
    meta?: string;
  }>(),
  { variant: 'card', meta: '' },
);

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
const label = computed(() => (props.course.category_name ?? '').trim());
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
      <!-- 极细线：一个描边圆弧 + 一道 45° 线，压在右下角，14% 墨色 -->
      <svg class="art__rule" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle cx="78" cy="42" r="44" />
        <path d="M0 120 120 0" />
      </svg>

      <div class="art__body">
        <span v-if="label" class="art__label">{{ label }}</span>
        <span class="art__foot">
          <span v-if="isHero" class="art__name" aria-hidden="true">{{ course.name }}</span>
          <span v-if="meta" class="art__meta" aria-hidden="true">{{ meta }}</span>
        </span>
      </div>
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
  background: var(--mc-cover-stone);
  color: var(--mc-cover-ink);
}

/* 三色盘：纸底只由分类决定；暗色主题在 tokens 里整体降一档，构图不变 */
.art[data-tone='mist'] {
  background: var(--mc-cover-mist);
}

.art[data-tone='stone'] {
  background: var(--mc-cover-stone);
}

.art[data-tone='sand'] {
  background: var(--mc-cover-sand);
}

.art__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ---------- 编辑式封面：细线 + 文字 ---------- */
.art__rule {
  position: absolute;
  right: calc(var(--mc-space-6) * -1);
  bottom: calc(var(--mc-space-6) * -1);
  width: 120px;
  height: 120px;
  fill: none;
  stroke: var(--mc-cover-rule);
  stroke-width: 1;
  pointer-events: none;
}

.art__body {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--mc-space-2);
  padding: var(--mc-space-4);
}

.art__label {
  /* 右上角可能压着状态徽标，标签提前收窄，长分类名不会钻到徽标底下 */
  max-width: calc(100% - 56px);
  overflow: hidden;
  color: var(--mc-cover-ink-muted);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  letter-spacing: var(--mc-tracking-label);
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.art__foot {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  /* 给右下角的细线让位，长标题的第二行不会压在圆弧上 */
  padding-right: var(--mc-space-6);
}

/* 封面上的课程名是"印在纸上的一行小字"，不是第二个标题：
   卡片里只给一行，长名字省略，避免同一个名字在封面和标题里各占两行。 */
.art__name {
  overflow: hidden;
  color: var(--mc-cover-ink-muted);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  letter-spacing: var(--mc-tracking-cn);
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.art__meta {
  overflow: hidden;
  color: var(--mc-cover-ink-muted);
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  line-height: var(--mc-leading-snug);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Hero：同一构图，留白放大一档 ---------- */
.art--hero .art__body {
  padding: var(--mc-space-5);
}

.art--hero .art__name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: var(--mc-text-sm);
  white-space: normal;
}

.art--hero .art__foot {
  padding-right: var(--mc-space-8);
}

/* ---------- 列表缩略图：中性块 + 首字 ---------- */
.art--row {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mc-cover-row-bg);
  color: var(--mc-cover-row-fg);
}

.art__row-initial {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
}
</style>
