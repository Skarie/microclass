import { computed, reactive } from 'vue';
import type { BarItem } from '@/components/charts/types';
import {
  MASTERY_ICON,
  MASTERY_LABEL,
  MASTERY_TONE,
  pct,
  type MasterySegment,
} from '@/views/admin/analytics/analytics-types';
import type { AnalyticsState } from './use-analytics';

/**
 * 学情分析的展示层派生：KPI 迷你序列、掌握度环形段、三个条形榜。
 * 只读 `useAnalytics` 的响应式状态，不发请求；页面把结果分发给子组件。
 */
export function useAnalyticsCharts(analytics: AnalyticsState) {
  /** 趋势序列（KPI 迷你图用） */
  const trendSeries = computed(() => (analytics.overview?.trend ?? []).map((t) => t.graded));

  /** 正确率迷你序列（0–100） */
  const accuracySeries = computed(() => (analytics.overview?.trend ?? []).map((t) => Math.round(t.accuracy * 100)));

  /** 掌握度知识点总数（环形图圆心用） */
  const masteryTotal = computed(() => (analytics.overview?.mastery ?? []).reduce((sum, m) => sum + m.points, 0));

  /** 掌握度环形图段 */
  const masterySegments = computed<MasterySegment[]>(() =>
    (analytics.overview?.mastery ?? []).map((m) => ({
      label: MASTERY_LABEL[m.level],
      value: m.points,
      tone: MASTERY_TONE[m.level] === 'neutral' ? 'info' : MASTERY_TONE[m.level],
      icon: MASTERY_ICON[m.level],
    })),
  );

  /** 知识点条形榜：条长 = 错误量，颜色按掌握度 */
  const pointBars = computed<BarItem[]>(() =>
    (analytics.points?.points ?? []).map((p) => ({
      key: p.point,
      label: p.point,
      value: p.wrong,
      tone:
        p.mastery === 'poor'
          ? 'danger'
          : p.mastery === 'weak'
            ? 'warning'
            : p.mastery === 'mastered'
              ? 'success'
              : 'info',
      icon: MASTERY_ICON[p.mastery],
      valueText: pct(p.accuracy),
      hint: `${p.wrong} 错 / ${p.graded} 作答 · ${p.questions} 题`,
    })),
  );

  /** 学员条形榜：条长 = 错题数 */
  const studentBars = computed<BarItem[]>(() =>
    (analytics.students?.students ?? []).map((s) => ({
      key: s.user_id,
      label: s.display_name || s.username,
      value: s.wrong,
      tone: s.level === 'poor' ? 'danger' : s.level === 'weak' ? 'warning' : 'success',
      icon: 'users',
      valueText: `${s.wrong} 题`,
      hint: `正确率 ${pct(s.accuracy)} · ${s.graded} 条作答${s.weakest_point ? ` · 最弱：${s.weakest_point}` : ''}`,
    })),
  );

  /** 高频错题条：**条长 = 错误率**（越长越该讲），颜色按严重程度 */
  const wrongBars = computed<BarItem[]>(() =>
    (analytics.wrong?.questions ?? []).map((q) => {
      const errorRate = 1 - q.accuracy;
      return {
        key: q.question_id,
        label: q.stem,
        richText: true,
        value: Math.round(errorRate * 100),
        max: 100,
        tone: errorRate >= 0.5 ? 'danger' : errorRate >= 0.2 ? 'warning' : 'success',
        icon: 'flame',
        valueText: `错 ${Math.round(errorRate * 100)}%`,
        hint: `${q.graded} 次作答错 ${q.wrong} 次 · ${q.students} 人 · ${q.point || '未归类'}`,
      };
    }),
  );

  return reactive({ trendSeries, accuracySeries, masteryTotal, masterySegments, pointBars, studentBars, wrongBars });
}

export type AnalyticsCharts = ReturnType<typeof useAnalyticsCharts>;
