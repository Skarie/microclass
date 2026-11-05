<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import StatsSummary from './StatsSummary.vue';
import { courseSummary } from './stats-types';
import type { CourseStats } from '@/api/types';

/**
 * 课程统计面板：未选课程 / 加载骨架 / 无课时 / 加载失败 / 课时明细表。
 * 统计接口在 composables/use-stats.ts，KPI 卡片见 StatsSummary。
 */
const props = defineProps<{
  courseId: number | '';
  courseStats: CourseStats | null;
  loading: boolean;
}>();

const summary = computed(() => (props.courseStats ? courseSummary(props.courseStats) : []));
</script>

<template>
  <section v-if="courseId === ''" class="mc-card">
    <EmptyState
      icon="stats"
      title="请选择要统计的课程"
      description="选择课程后，可以看到每节课的完成率、刷题率与平均分。"
    />
  </section>

  <section v-else-if="loading && !courseStats" class="mc-card loading">
    <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
  </section>

  <template v-else-if="courseStats">
    <StatsSummary :items="summary" />

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">{{ courseStats.course.name }} · 课时明细</span>
        <span class="mc-muted">共 {{ courseStats.lessons.length }} 个课时</span>
      </div>

      <div v-if="courseStats.lessons.length === 0" class="mc-card__body">
        <EmptyState icon="video" title="该课程还没有课时" description="先到「课时管理」中添加视频课时。" />
      </div>

      <div v-else class="mc-table-wrap table-wrap">
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>章节</th>
              <th>课时</th>
              <th>观看</th>
              <th>完成</th>
              <th>已刷题</th>
              <th>完成率</th>
              <th>刷题率</th>
              <th>平均分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in courseStats.lessons" :key="row.id">
              <td>{{ row.group_name || '未分章' }}</td>
              <td>
                <span class="lesson-name">{{ row.title }}</span>
              </td>
              <td>{{ row.watched }}</td>
              <td>{{ row.finished }}</td>
              <td>{{ row.quizzed }}</td>
              <td>
                <div class="progress-cell">
                  <div class="mc-progress">
                    <div
                      class="mc-progress__bar"
                      :class="{ 'mc-progress__bar--success': row.finish_rate >= 100 }"
                      :style="{ transform: `scaleX(${Math.min(100, Math.max(0, row.finish_rate)) / 100})` }"
                    />
                  </div>
                  <span class="mc-muted progress-cell__text">{{ row.finish_rate }}%</span>
                </div>
              </td>
              <td>
                <div class="progress-cell">
                  <div class="mc-progress">
                    <div
                      class="mc-progress__bar"
                      :style="{ transform: `scaleX(${Math.min(100, Math.max(0, row.quiz_rate)) / 100})` }"
                    />
                  </div>
                  <span class="mc-muted progress-cell__text">{{ row.quiz_rate }}%</span>
                </div>
              </td>
              <td>{{ row.avg_score }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <section v-else class="mc-card">
    <EmptyState icon="stats" title="暂时无法加载课程统计" description="请点击右上角刷新重试。" />
  </section>
</template>

<style scoped src="./stats-table.css"></style>

<style scoped>
/* 课时名过长时省略，避免把表格撑出横向滚动（拆分前在父页面） */
.lesson-name {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
