<script setup lang="ts">
/**
 * 行内指标条（替代"英雄指标卡"）
 *
 * 为什么要有它：页面顶部一排"大数字 + 小标签"的同构卡片属于反模式 #20，
 * 它们占了四张卡的位置只传达四个数字。指标条把这些事实压成一行，把版面留给真正的主视觉。
 *
 * 什么时候仍该用 StatCard：指标本身带**可视化证据**（进度环、走势、对比）时——
 * 那种卡片承载了决策信息，不算套模板。
 */
interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  /** 补充事实（如"最近范围内有作答的学员"） */
  hint?: string;
  /** 0~100：在图条里显示一条迷你进度，用来表达比例类指标 */
  progress?: number;
}

defineProps<{ items: MetricItem[] }>();
</script>

<template>
  <dl class="metrics">
    <div
      v-for="(m, i) in items"
      :key="`${m.label}-${i}`"
      class="metrics__item"
      :class="`metrics__item--${m.tone ?? 'neutral'}`"
    >
      <dt class="metrics__label">{{ m.label }}</dt>
      <!-- 说明与迷你进度放进 dd：<dl> 的直接子元素只能是 dt/dd 分组（axe 会查） -->
      <dd class="metrics__value mc-num">
        {{ m.value }}<span v-if="m.unit" class="metrics__unit">{{ m.unit }}</span>
        <span v-if="typeof m.progress === 'number'" class="metrics__bar" aria-hidden="true">
          <i :style="{ width: `${Math.max(0, Math.min(100, m.progress))}%` }" />
        </span>
        <span v-if="m.hint" class="metrics__hint">{{ m.hint }}</span>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--mc-space-4) var(--mc-space-8);
  margin: 0;
}

.metrics__item {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  padding-left: var(--mc-space-4);
  border-left: 1px solid var(--mc-border);
}

/* 首个不画分隔线（避免左边凭空多一条） */
.metrics__item:first-child {
  padding-left: 0;
  border-left: 0;
}

.metrics__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.metrics__value {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-display);
  color: var(--mc-text);
}

.metrics__unit {
  margin-left: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.metrics__item--primary .metrics__value {
  color: var(--mc-primary-fg);
}

.metrics__item--success .metrics__value {
  color: var(--mc-success-fg);
}

.metrics__item--warning .metrics__value {
  color: var(--mc-warning-fg);
}

.metrics__item--danger .metrics__value {
  color: var(--mc-danger-fg);
}

.metrics__item--info .metrics__value {
  color: var(--mc-info-fg);
}

.metrics__bar {
  display: block;
  width: 96px;
  height: 4px;
  margin-top: var(--mc-space-1);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.metrics__bar i {
  display: block;
  height: 100%;
  border-radius: var(--mc-radius-pill);
  background-image: var(--mc-gradient-progress);
}

.metrics__hint {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

@media (max-width: 720px) {
  .metrics {
    gap: var(--mc-space-3) var(--mc-space-4);
  }

  .metrics__item {
    padding-left: var(--mc-space-3);
  }
}
</style>
