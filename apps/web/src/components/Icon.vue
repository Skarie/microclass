<script setup lang="ts">
/**
 * 图标：内联 SVG，统一线宽与尺寸。
 *
 * 为什么不用 emoji：emoji 的字形、线宽、颜色由系统字体决定，跨平台不一致，
 * 也无法跟随主题色（真机审计发现 44 处 emoji 当图标用）。这里统一成
 * 24×24 viewBox、`currentColor` 描边、圆角端点，尺寸走 `--mc-icon-*` 令牌；
 * 图标名是联合类型，写错在 typecheck 阶段就能发现。
 */
import { computed } from 'vue';
import { ICONS, type IconName, type IconShape } from './icons';

const props = withDefaults(
  defineProps<{
    name: IconName;
    /** 视觉尺寸，默认 20px */
    size?: number | string;
    /** 线宽 */
    stroke?: number;
    /** 实心填充（星标、评分这类状态图标） */
    filled?: boolean;
  }>(),
  { size: 'var(--mc-icon-md)', stroke: 1.75, filled: false },
);

const px = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size));
const shapes = computed(() => ICONS[props.name]);
// 模板里 `'circle' in shape` 不能跨绑定收窄类型，这里用取值函数兜住
const circleOf = (s: IconShape): [number, number, number] => ('circle' in s ? s.circle : [0, 0, 0]);
const rectOf = (s: IconShape): [number, number, number, number, number] =>
  'rect' in s ? [s.rect[0], s.rect[1], s.rect[2], s.rect[3], s.rect[4] ?? 0] : [0, 0, 0, 0, 0];
</script>

<template>
  <svg
    class="mc-icon"
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="stroke"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-for="(shape, i) in shapes" :key="i">
      <path v-if="'d' in shape" :d="shape.d" :fill="filled ? 'currentColor' : 'none'" />
      <circle
        v-else-if="'circle' in shape"
        :cx="circleOf(shape)[0]"
        :cy="circleOf(shape)[1]"
        :r="circleOf(shape)[2]"
        :fill="filled ? 'currentColor' : 'none'"
      />
      <rect
        v-else
        :x="rectOf(shape)[0]"
        :y="rectOf(shape)[1]"
        :width="rectOf(shape)[2]"
        :height="rectOf(shape)[3]"
        :rx="rectOf(shape)[4]"
      />
    </template>
  </svg>
</template>

<style scoped>
.mc-icon {
  flex: none;
  display: inline-block;
  vertical-align: -0.15em;
}
</style>
