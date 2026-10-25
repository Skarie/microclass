<script setup lang="ts">
import StatCard from '@/components/StatCard.vue';
import ProgressRing from '@/components/charts/ProgressRing.vue';
import Sparkline from '@/components/charts/Sparkline.vue';
import { pct, type AnalyticsOverview } from './analytics-types';

/**
 * 页头 KPI 行：活跃学员 / 作答条目 / 整体正确率 / 题目覆盖 / 知识点覆盖。
 * 数值口径全部来自 overview，迷你图序列由 use-analytics-charts 派生。
 */
defineProps<{ overview: AnalyticsOverview; trendSeries: number[]; accuracySeries: number[] }>();
</script>

<template>
  <div class="ana__kpis">
    <StatCard
      label="活跃学员"
      :value="overview.kpi.activeStudents"
      :unit="`/ ${overview.kpi.students} 人`"
      icon="users"
      tone="primary"
      hint="最近范围内有作答的学员"
    >
      <template #visual>
        <ProgressRing
          :value="overview.kpi.students > 0 ? overview.kpi.activeStudents / overview.kpi.students : 0"
          :label="`活跃率 ${overview.kpi.students > 0 ? Math.round((overview.kpi.activeStudents / overview.kpi.students) * 100) : 0}%`"
          tone="info"
        />
      </template>
    </StatCard>
    <StatCard
      label="作答条目"
      :value="overview.kpi.graded"
      icon="chartBar"
      :hint="`练习 ${overview.kpi.practiceAttempts} 次 · 考试 ${overview.kpi.examAttempts} 次`"
    >
      <template #visual>
        <Sparkline :values="trendSeries" tone="primary" />
        <span class="mc-muted ana__sparkhint">近 30 天</span>
      </template>
    </StatCard>
    <StatCard
      label="整体正确率"
      :value="pct(overview.kpi.accuracy)"
      icon="check"
      :tone="overview.kpi.accuracy >= 0.8 ? 'success' : overview.kpi.accuracy >= 0.6 ? 'warning' : 'danger'"
      :hint="`错 ${overview.kpi.wrong} 条`"
    >
      <template #visual>
        <ProgressRing
          :value="overview.kpi.accuracy"
          :tone="overview.kpi.accuracy >= 0.8 ? 'success' : overview.kpi.accuracy >= 0.6 ? 'warning' : 'danger'"
          :label="`整体正确率 ${pct(overview.kpi.accuracy)}`"
        />
        <Sparkline :values="accuracySeries" tone="success" />
      </template>
    </StatCard>
    <StatCard
      label="题目覆盖"
      :value="`${overview.kpi.questionCoverage}%`"
      icon="bank"
      :hint="`${overview.kpi.questionsWithData.toLocaleString()} / ${overview.kpi.totalQuestions.toLocaleString()} 题有作答数据`"
    >
      <template #visual>
        <ProgressRing
          :value="overview.kpi.questionCoverage / 100"
          tone="info"
          :text="`${overview.kpi.questionCoverage}%`"
          :label="`题目覆盖率 ${overview.kpi.questionCoverage}%`"
        />
      </template>
    </StatCard>
    <StatCard
      label="知识点覆盖"
      :value="`${overview.kpi.pointCoverage}%`"
      icon="target"
      :hint="`${overview.kpi.pointsWithData.toLocaleString()} / ${overview.kpi.totalPoints.toLocaleString()} 个知识点`"
    >
      <template #visual>
        <ProgressRing
          :value="overview.kpi.pointCoverage / 100"
          tone="primary"
          :text="`${overview.kpi.pointCoverage}%`"
          :label="`知识点覆盖率 ${overview.kpi.pointCoverage}%`"
        />
      </template>
    </StatCard>
  </div>
</template>

<style scoped>
/* 迷你图下方的走势说明：之前没有样式，窄列里被挤成三行 */
.ana__sparkhint {
  display: block;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  text-align: center;
  white-space: nowrap;
}

.ana__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--mc-space-3);
}
</style>
