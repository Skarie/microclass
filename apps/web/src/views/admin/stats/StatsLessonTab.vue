<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import StatsSummary from './StatsSummary.vue';
import { formatTime, lessonSummary } from './stats-types';
import type { LessonStats } from '@/api/types';

/**
 * 课时统计面板：未选课时 / 加载骨架 / 无学员数据 / 加载失败 / 学员明细表。
 * 统计接口在 composables/use-stats.ts，KPI 卡片见 StatsSummary。
 */
const props = defineProps<{
  lessonId: number | '';
  lessonStats: LessonStats | null;
  loading: boolean;
}>();

const summary = computed(() => (props.lessonStats ? lessonSummary(props.lessonStats) : []));
</script>

<template>
  <section v-if="lessonId === ''" class="mc-card">
    <EmptyState
      icon="stats"
      title="请选择要统计的课时"
      description="选择课程与课时后，可以看到每位学员的观看时长、完成情况与练习成绩。"
    />
  </section>

  <section v-else-if="loading && !lessonStats" class="mc-card loading">
    <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
  </section>

  <template v-else-if="lessonStats">
    <StatsSummary :items="summary" />

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">{{ lessonStats.lesson.title }}</span>
        <span class="mc-muted">{{ lessonStats.summary.not_quizzed }} 人尚未刷题</span>
      </div>

      <div v-if="lessonStats.rows.length === 0" class="mc-card__body">
        <EmptyState
          icon="users"
          title="还没有学员数据"
          description="学员开始观看该课时后，这里会显示每个人的学习进度。"
        />
      </div>

      <div v-else class="mc-table-wrap table-wrap">
        <table class="mc-table mc-table--compact">
          <thead>
            <tr>
              <th>学号</th>
              <th>姓名</th>
              <th>观看</th>
              <th>完成</th>
              <th>进度</th>
              <th>刷题</th>
              <th>最好成绩</th>
              <th>次数</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in lessonStats.rows" :key="row.id">
              <td class="mc-mono">{{ row.username }}</td>
              <td>{{ row.display_name || '—' }}</td>
              <td>
                <span class="mc-badge" :class="row.watched ? 'mc-badge--success' : ''">
                  {{ row.watched ? '已观看' : '未观看' }}
                </span>
              </td>
              <td>
                <span class="mc-badge" :class="row.finished ? 'mc-badge--success' : 'mc-badge--warning'">
                  {{ row.finished ? '已完成' : '未完成' }}
                </span>
              </td>
              <td>
                <div class="progress-cell">
                  <div class="mc-progress">
                    <div
                      class="mc-progress__bar"
                      :class="{ 'mc-progress__bar--success': row.finished }"
                      :style="{ transform: `scaleX(${Math.min(100, Math.max(0, row.percent)) / 100})` }"
                    />
                  </div>
                  <span class="mc-muted progress-cell__text">{{ row.percent }}%</span>
                </div>
              </td>
              <td>
                <span class="mc-badge" :class="row.quiz_done ? 'mc-badge--primary' : ''">
                  {{ row.quiz_done ? '已完成' : '未完成' }}
                </span>
              </td>
              <td>{{ row.best_score }}</td>
              <td>{{ row.attempts }}</td>
              <td class="mc-muted">{{ formatTime(row.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <section v-else class="mc-card">
    <EmptyState icon="stats" title="暂时无法加载课时统计" description="请点击右上角刷新重试。" />
  </section>
</template>

<style scoped src="./stats-table.css"></style>
