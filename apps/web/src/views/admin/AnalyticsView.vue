<script setup lang="ts">
/**
 * 学情分析（机构视角）：从**真实作答数据**看掌握情况，指导讲评与补课。
 *
 * 与「学习统计」的分工：
 *   - 学习统计：看视频/打卡/是否刷题（学习行为）；
 *   - 学情分析：作答正确率、知识点掌握度、高频错题、讲评清单（学习效果）。
 *
 * 三条界面原则：
 *   1. 顶部永远显示 `dataNote` —— 数据很少时明说"样本很少，结论仅供参考"，
 *      不能让机构拿一份几乎没数据的报表去做教学决策；
 *   2. 掌握度分档与后端阈值一致，**数据不足单独一档**，不混进"未掌握"；
 *   3. 空状态给"接下来做什么"的指引，而不是空白页。
 *
 * 页面只做编排：数据与请求在 composables/use-analytics.ts，展示层派生在
 * use-analytics-charts.ts；界面按「页头动作 / 范围筛选 / 数据说明 / KPI /
 * 掌握度 / 页签 / 四个页签面板」拆到 ./analytics/*。
 */
import { onMounted } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import AnalyticsHeaderActions from './analytics/AnalyticsHeaderActions.vue';
import AnalyticsScopeBar from './analytics/AnalyticsScopeBar.vue';
import AnalyticsDataNote from './analytics/AnalyticsDataNote.vue';
import AnalyticsKpiRow from './analytics/AnalyticsKpiRow.vue';
import AnalyticsMasteryCard from './analytics/AnalyticsMasteryCard.vue';
import AnalyticsTabs from './analytics/AnalyticsTabs.vue';
import AnalyticsPointsTab from './analytics/AnalyticsPointsTab.vue';
import AnalyticsStudentsTab from './analytics/AnalyticsStudentsTab.vue';
import AnalyticsWrongTab from './analytics/AnalyticsWrongTab.vue';
import AnalyticsTrendTab from './analytics/AnalyticsTrendTab.vue';
import { useAnalytics } from '@/composables/use-analytics';
import { useAnalyticsCharts } from '@/composables/use-analytics-charts';

const analytics = useAnalytics();
const charts = useAnalyticsCharts(analytics);

onMounted(() => void analytics.init());

function changeCourse(courseId: number | ''): void {
  analytics.filters.courseId = courseId;
  void analytics.loadAll();
}

function changeDays(days: number): void {
  analytics.filters.days = days;
  void analytics.loadAll();
}

function changeMinAttempts(minAttempts: number): void {
  analytics.minAttempts = minAttempts;
  void analytics.loadTab();
}
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学情分析"
      description="用真实作答数据看掌握情况：哪些知识点没掌握、哪些题错得多、讲评该讲什么。"
      icon="target"
    >
      <template #actions>
        <AnalyticsHeaderActions
          :loading="analytics.loading"
          @refresh="analytics.loadAll"
          @export="analytics.exportFile"
        />
      </template>
    </PageHeader>

    <AnalyticsScopeBar
      :courses="analytics.courses"
      :course-id="analytics.filters.courseId"
      :days="analytics.filters.days"
      :generated-at="analytics.overview?.generatedAt ?? null"
      @course-change="changeCourse"
      @days-change="changeDays"
    />

    <!-- 数据规模说明：永远显示，样本少时用警示色，避免误读 -->
    <AnalyticsDataNote
      v-if="analytics.overview"
      :graded="analytics.overview.kpi.graded"
      :note="analytics.overview.dataNote"
    />

    <AnalyticsKpiRow
      v-if="analytics.overview"
      :overview="analytics.overview"
      :trend-series="charts.trendSeries"
      :accuracy-series="charts.accuracySeries"
    />

    <AnalyticsMasteryCard v-if="analytics.overview" :segments="charts.masterySegments" :total="charts.masteryTotal" />

    <AnalyticsTabs :tab="analytics.tab" @select="analytics.switchTab" />

    <AnalyticsPointsTab v-if="analytics.tab === 'points'" :points="analytics.points" :bars="charts.pointBars" />
    <AnalyticsStudentsTab
      v-else-if="analytics.tab === 'students'"
      :students="analytics.students"
      :bars="charts.studentBars"
    />
    <AnalyticsWrongTab
      v-else-if="analytics.tab === 'wrong'"
      :wrong="analytics.wrong"
      :bars="charts.wrongBars"
      :min-attempts="analytics.minAttempts"
      @min-change="changeMinAttempts"
    />
    <AnalyticsTrendTab v-else :trend="analytics.overview?.trend ?? []" />
  </section>
</template>
