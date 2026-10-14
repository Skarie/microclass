<script setup lang="ts">
/**
 * 趋势图：作答量（面积）+ 正确率（折线），带坐标轴、网格线、悬浮数值。
 *
 * 无障碍：整图 `role="img"` + aria-label（概览：区间、总量、峰值）；
 * 每个数据点另有 `<title>`（原生 tooltip，鼠标停留即显示日期/作答/正确率）。
 * 悬浮十字线用纯 CSS/SVG 实现，不引第三方库。
 */
import { computed, ref } from 'vue';
import { areaPath, axisTicks, linePath, linePoints, niceMax } from '@/utils/chart';
import Icon from '@/components/Icon.vue';

const props = withDefaults(
  defineProps<{
    data: { day: string; graded: number; wrong: number; accuracy: number }[];
    height?: number;
    caption?: string;
  }>(),
  { height: 220, caption: '' },
);

const width = 1200;
const pad = { top: 16, right: 46, bottom: 26, left: 46 };

const hover = ref<number | null>(null);

const plotHeight = computed(() => props.height - pad.top - pad.bottom);
const plotWidth = computed(() => width - pad.left - pad.right);

const maxGraded = computed(() => niceMax(Math.max(...props.data.map((d) => d.graded), 1)));
const ticks = computed(() => axisTicks(maxGraded.value, 4));

const bars = computed(() =>
  props.data.map((d, i) => {
    const n = props.data.length;
    const step = n <= 1 ? plotWidth.value : plotWidth.value / n;
    // 柱宽上限：只有三五天数据时，按比例算出来的柱子会宽得离谱（像色块）
    const w = Math.max(2, Math.min(44, step * 0.7));
    const x = pad.left + step * i + (step - w) / 2;
    const h = Math.max(d.graded > 0 ? 2 : 0, (d.graded / maxGraded.value) * plotHeight.value);
    const wrongH = d.graded > 0 ? (d.wrong / maxGraded.value) * plotHeight.value : 0;
    return { ...d, x, w, y: pad.top + plotHeight.value - h, h, wrongH };
  }),
);

const accuracyPoints = computed(() =>
  linePoints(
    props.data.map((d) => ({ label: d.day, value: d.accuracy * 100 })),
    { width, height: props.height, max: 100, padding: { ...pad, right: pad.right } },
  ),
);

const areaD = computed(() =>
  areaPath(accuracyPoints.value, { height: props.height, baselineY: pad.top + plotHeight.value }),
);

/** x 轴标签抽稀：最多显示 8 个，避免挤成一团 */
const labelStep = computed(() => Math.max(1, Math.ceil(props.data.length / 8)));

const summary = computed(() => {
  const total = props.data.reduce((s, d) => s + d.graded, 0);
  const wrong = props.data.reduce((s, d) => s + d.wrong, 0);
  const acc = total > 0 ? Math.round(((total - wrong) / total) * 100) : 0;
  const first = props.data[0]?.day ?? '';
  const last = props.data[props.data.length - 1]?.day ?? '';
  return `${first} 至 ${last}：共 ${total} 条作答、${wrong} 条错误、整体正确率 ${acc}%`;
});

function tooltipFor(index: number): string {
  const d = props.data[index];
  if (!d) return '';
  return `${d.day}：${d.graded} 条作答，错 ${d.wrong} 条，正确率 ${Math.round(d.accuracy * 100)}%`;
}
</script>

<template>
  <div class="trend">
    <div v-if="data.length === 0" class="mc-muted trend__empty">范围内没有作答记录</div>
    <template v-else>
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        class="trend__svg"
        role="img"
        :aria-label="caption || `作答趋势折线图。${summary}`"
        @mouseleave="hover = null"
      >
        <!-- 网格与 y 轴刻度 -->
        <g aria-hidden="true">
          <template v-for="(t, i) in ticks" :key="`t-${i}`">
            <line
              :x1="pad.left"
              :x2="width - pad.right"
              :y1="pad.top + plotHeight - (t / maxGraded) * plotHeight"
              :y2="pad.top + plotHeight - (t / maxGraded) * plotHeight"
              class="trend__grid"
            />
            <text
              :x="pad.left - 8"
              :y="pad.top + plotHeight - (t / maxGraded) * plotHeight + 4"
              class="trend__tick"
              text-anchor="end"
            >
              {{ t }}
            </text>
          </template>
          <!-- 右轴：正确率 0–100% -->
          <text :x="width - pad.right + 8" :y="pad.top + 4" class="trend__tick">100%</text>
          <text :x="width - pad.right + 8" :y="pad.top + plotHeight + 4" class="trend__tick">0%</text>
        </g>

        <!-- 每天一根柱：整根=作答量，深色部分=错误量 -->
        <g aria-hidden="true">
          <g v-for="(b, i) in bars" :key="`b-${b.day}`" @mouseenter="hover = i">
            <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" class="trend__bar" />
            <rect
              v-if="b.wrongH > 0"
              :x="b.x"
              :y="pad.top + plotHeight - b.wrongH"
              :width="b.w"
              :height="b.wrongH"
              rx="2"
              class="trend__barwrong"
            />
            <!-- 透明热区，保证柱子很矮时也能悬停 -->
            <rect :x="b.x" :y="pad.top" :width="b.w" :height="plotHeight" fill="transparent" />
          </g>
        </g>

        <!-- 正确率折线 + 面积 -->
        <path :d="areaD" class="trend__area" aria-hidden="true" />
        <path :d="linePath(accuracyPoints)" class="trend__line" aria-hidden="true" />
        <g aria-hidden="true">
          <circle
            v-for="(p, i) in accuracyPoints"
            :key="`p-${i}`"
            :cx="p.x"
            :cy="p.y"
            :r="hover === i ? 4.5 : 2.6"
            class="trend__dot"
          />
        </g>

        <!-- 悬浮十字线 -->
        <line
          v-if="hover !== null && accuracyPoints[hover]"
          :x1="accuracyPoints[hover]!.x"
          :x2="accuracyPoints[hover]!.x"
          :y1="pad.top"
          :y2="pad.top + plotHeight"
          class="trend__crosshair"
          aria-hidden="true"
        />

        <!-- x 轴日期 -->
        <g aria-hidden="true">
          <text
            v-for="(b, i) in bars"
            v-show="i % labelStep === 0"
            :key="`x-${b.day}`"
            :x="b.x + b.w / 2"
            :y="height - 8"
            class="trend__tick"
            text-anchor="middle"
          >
            {{ b.day.slice(5) }}
          </text>
        </g>

        <!-- 原生 tooltip：每个点都能鼠标查看数值 -->
        <g aria-hidden="true">
          <circle v-for="(b, i) in bars" :key="`tip-${b.day}`" :cx="b.x + b.w / 2" :cy="pad.top + 10" r="0">
            <title>{{ tooltipFor(i) }}</title>
          </circle>
        </g>
      </svg>

      <div class="trend__legend">
        <span class="trend__key"><span class="trend__swatch trend__swatch--bar" />作答量</span>
        <span class="trend__key"><span class="trend__swatch trend__swatch--wrong" />其中错误</span>
        <span class="trend__key"><span class="trend__swatch trend__swatch--line" />正确率</span>
        <span class="mc-spacer" />
        <span v-if="hover !== null" class="trend__hover">
          <Icon name="info" :size="14" />
          {{ tooltipFor(hover) }}
        </span>
        <span v-else class="mc-muted trend__hover">鼠标移到柱子上看当天明细</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.trend {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.trend__svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.trend__empty {
  padding: var(--mc-space-6);
  text-align: center;
}

.trend__grid {
  stroke: var(--mc-border);
  stroke-dasharray: 3 3;
}

.trend__tick {
  font-size: 10px;
  fill: var(--mc-text-muted);
}

.trend__bar {
  fill: var(--mc-chart-1);
  opacity: 0.55;
}

.trend__barwrong {
  fill: var(--mc-danger);
  opacity: 0.85;
}

.trend__area {
  fill: var(--mc-chart-3);
  opacity: 0.16;
}

.trend__line {
  fill: none;
  stroke: var(--mc-chart-3);
  stroke-width: 2;
}

.trend__dot {
  fill: var(--mc-chart-3);
}

.trend__crosshair {
  stroke: var(--mc-border-strong);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.trend__legend {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.trend__key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.trend__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.trend__swatch--bar {
  background: var(--mc-chart-1);
  opacity: 0.55;
}

.trend__swatch--wrong {
  background: var(--mc-danger);
}

.trend__swatch--line {
  background: var(--mc-chart-3);
}

.trend__hover {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--mc-text);
}
</style>
