<script setup lang="ts">
/**
 * 首页 · 我的学习看板：四张语义色 KPI 卡 + 一条等级进度色带。
 * 四张卡不是同构白卡：每种语义域一条色带（主色 / 青 / 靛 / 赭），数字用对应 strong。
 */
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import type { HomeMetric } from '@/composables/use-home-dashboard';

defineProps<{
  metrics: HomeMetric[];
  level: string;
  levelHint: string;
  learningDone: number;
  learningTotal: number;
  learningPercent: number;
  learningCount: number;
}>();
</script>

<template>
  <section class="board" aria-label="我的学习数据">
    <div class="board__metrics">
      <div v-for="m in metrics" :key="m.label" class="board__metric" :class="`board__metric--${m.tone}`">
        <span class="board__band" aria-hidden="true" />
        <span class="board__icon"><Icon :name="m.icon" :size="18" /></span>
        <span class="board__value mc-num">
          {{ m.value }}<span class="board__unit">{{ m.unit }}</span>
        </span>
        <span class="board__label">{{ m.label }}</span>
      </div>
    </div>

    <div class="board__level">
      <span class="board__level-icon"><Icon name="award" :size="20" /></span>
      <div class="board__level-main">
        <div class="board__level-head">
          <span class="board__level-name">{{ level }}</span>
          <span class="board__level-hint">{{ levelHint }}</span>
        </div>
        <p class="board__overall">
          在学课程进度
          <strong class="mc-num">{{ learningDone }}/{{ learningTotal }}</strong>
          课时
          <template v-if="learningCount === 0">（暂无在学课程）</template>
        </p>
        <ProgressBar :value="learningPercent" tone="primary" :show-end="false" :label="`${learningPercent}%`" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.board__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--mc-space-4);
}

.board__metric {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  overflow: hidden;
  padding: var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  transition: var(--mc-transition-all);
}

/* 顶部 4px 色带：用 inset 色块而不是 border-top，圆角处不会出现「厚边框」 */
.board__band {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4px;
  background: var(--kpi-tone, var(--mc-border));
}

@media (hover: hover) and (pointer: fine) {
  .board__metric:hover {
    border-color: var(--kpi-tone, var(--mc-border));
    transform: translateY(var(--mc-hover-lift));
  }
}

.board__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mc-radius-xs);
  background: var(--kpi-soft, var(--mc-bg-sunken));
  color: var(--kpi-fg, var(--mc-text-secondary));
}

.board__value {
  /* 首页 KPI 数字 32px（设计守卫白名单的 32 档；token 仍是 5 档字阶） */
  font-size: 32px;
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  color: var(--kpi-strong, var(--mc-text));
}

.board__unit {
  margin-left: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.board__label {
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-muted);
}

.board__metric--primary {
  --kpi-tone: var(--mc-primary);
  --kpi-soft: var(--mc-primary-soft);
  --kpi-fg: var(--mc-primary-fg);
  --kpi-strong: var(--mc-primary-strong);
}

.board__metric--cyan {
  --kpi-tone: var(--mc-cyan);
  --kpi-soft: var(--mc-cyan-soft);
  --kpi-fg: var(--mc-cyan-fg);
  --kpi-strong: var(--mc-cyan-strong);
}

.board__metric--indigo {
  --kpi-tone: var(--mc-indigo);
  --kpi-soft: var(--mc-indigo-soft);
  --kpi-fg: var(--mc-indigo-fg);
  --kpi-strong: var(--mc-indigo-strong);
}

.board__metric--terra {
  --kpi-tone: var(--mc-terra);
  --kpi-soft: var(--mc-terra-soft);
  --kpi-fg: var(--mc-terra-fg);
  --kpi-strong: var(--mc-terra-strong);
}

/* 等级条：第五块颜色，用主色 soft 把四张卡收成一组 */
.board__level {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-5);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-primary-soft);
}

.board__level-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
}

.board__level-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.board__level-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.board__level-name {
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.board__level-hint,
.board__overall {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-secondary);
}

.board__overall strong {
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

@media (max-width: 900px) {
  .board__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 360px) {
  .board__metrics {
    grid-template-columns: 1fr;
  }
}
</style>
