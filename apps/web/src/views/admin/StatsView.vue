<script setup lang="ts">
/**
 * 学习统计（机构视角）：按课时或课程查看学员观看时长、完成情况与练习成绩，可导出 CSV。
 *
 * 页面只做编排：数据、请求、筛选联动在 composables/use-stats.ts；
 * 工具栏在 ./stats/StatsToolbar.vue，课时 / 课程两个面板在 ./stats/StatsLessonTab.vue、
 * StatsCourseTab.vue，KPI 卡片共用 StatsSummary，展示派生与时间格式化在 stats-types.ts。
 *
 * 拆分时保持不变的行为（对齐拆分前 538 行的实现）：
 *   1. 接口与参数：`GET /courses`、`GET /lessons?course=<id>`、
 *      `GET /stats/lessons/:id`、`GET /stats/courses/:id`、对应 `.csv` 下载；
 *   2. 首屏顺序：课程 → 课时 → 课时统计；课程默认选中第一门；
 *   3. 筛选联动：切换课程清空课程统计并重拉课时，当前页签立即重载；
 *      切换课时只在课时页签下重拉统计；
 *   4. 空态 / 加载态 / 失败兜底文案逐字保留，不新增也不合并分支；
 *   5. 导出按钮的禁用条件：课时页签看课时，课程页签看课程。
 *
 * 样式：`<style scoped>` 不穿透子组件，KPI 卡片、工具栏、表格/进度条、
 * 骨架屏等规则已随对应组件一起搬走（表格与骨架屏共用 stats-table.css）。
 */
import { onMounted } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import StatsToolbar from './stats/StatsToolbar.vue';
import StatsLessonTab from './stats/StatsLessonTab.vue';
import StatsCourseTab from './stats/StatsCourseTab.vue';
import { useStats } from '@/composables/use-stats';
import type { StatsTab } from './stats/stats-types';

const stats = useStats();

onMounted(() => void stats.init());

function changeTab(next: StatsTab): void {
  void stats.switchTab(next);
}

function changeCourse(id: number | ''): void {
  stats.courseId = id;
}

function changeLesson(id: number | ''): void {
  stats.lessonId = id;
}
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学习统计"
      description="按课时或课程查看每位学员的观看时长、完成情况与练习成绩，可导出 CSV 给教研复盘。"
      icon="stats"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '学习统计' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" @click="stats.refresh">
          <Icon name="refresh" :size="16" />
          刷新
        </button>
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          :disabled="stats.tab === 'lesson' ? stats.lessonId === '' : stats.courseId === ''"
          @click="stats.exportCsv"
        >
          <Icon name="download" :size="16" />
          导出 CSV
        </button>
      </template>
    </PageHeader>

    <StatsToolbar
      :tab="stats.tab"
      :courses="stats.courses"
      :course-id="stats.courseId"
      :lessons="stats.lessons"
      :lesson-id="stats.lessonId"
      :lessons-loading="stats.lessonsLoading"
      @tab-change="changeTab"
      @course-change="changeCourse"
      @lesson-change="changeLesson"
    />

    <StatsLessonTab
      v-if="stats.tab === 'lesson'"
      :lesson-id="stats.lessonId"
      :lesson-stats="stats.lessonStats"
      :loading="stats.lessonLoading"
    />
    <StatsCourseTab
      v-else
      :course-id="stats.courseId"
      :course-stats="stats.courseStats"
      :loading="stats.courseLoading"
    />
  </section>
</template>

<style scoped>
.page {
  gap: var(--mc-space-5);
}
</style>
