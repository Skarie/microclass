<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import MetricBar from '@/components/MetricBar.vue';
import { fmtScore, formatSeconds, formatTime } from './exam-admin-format';
import type { Exam } from '@/api/types';
import type { ScoresResponse } from '@/composables/use-exam-admin-scores';

/**
 * 选中考试的成绩单面板：指标条 + 成绩表。
 * 组卷已挪到独立页面 /admin/exams/:id/compose，这里只保留成绩相关动作。
 */
defineProps<{
  exam: Exam;
  sheet: ScoresResponse | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  compose: [exam: Exam];
  refresh: [];
  export: [];
  print: [];
}>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <div class="mc-row mc-row--wrap">
        <span class="mc-card__title">{{ exam.title }}</span>
        <span class="mc-badge" :class="exam.status === 'published' ? 'mc-badge--success' : 'mc-badge--warning'">
          {{ exam.status === 'published' ? '已发布' : '草稿' }}
        </span>
      </div>
      <div class="mc-row">
        <button
          class="mc-btn mc-btn--primary mc-btn--sm"
          type="button"
          title="打开三步组卷页面"
          @click="emit('compose', exam)"
        >
          <Icon name="exam" :size="15" />
          进入组卷页面
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="!exam" @click="emit('print')">
          打印 / 导出 PDF
        </button>
      </div>
    </div>

    <!-- 成绩单（组卷已挪到独立页面 /admin/exams/:id/compose） -->
    <div class="mc-card__body mc-col">
      <div v-if="loading && !sheet" class="mc-skeleton loading__row" />

      <template v-else-if="sheet">
        <!-- 七个数字压成一条：把版面留给成绩表本身 -->
        <MetricBar
          :items="[
            { label: '参考人数', value: sheet.summary.attempts, unit: '人', tone: 'primary' },
            { label: '及格人数', value: sheet.summary.passed, unit: '人', tone: 'success' },
            {
              label: '及格率',
              value: `${sheet.summary.pass_rate}%`,
              tone: sheet.summary.pass_rate >= 60 ? 'success' : 'warning',
              progress: sheet.summary.pass_rate,
            },
            { label: '平均分', value: sheet.summary.avg },
            { label: '最高分', value: sheet.summary.best },
            { label: '最低分', value: sheet.summary.worst },
            { label: '平均用时', value: formatSeconds(sheet.summary.avg_seconds) },
          ]"
        />

        <div class="mc-row">
          <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="emit('refresh')">刷新</button>
          <div class="mc-spacer" />
          <button
            class="mc-btn mc-btn--sm mc-btn--primary"
            type="button"
            :disabled="sheet.rows.length === 0"
            @click="emit('export')"
          >
            导出成绩单 CSV
          </button>
        </div>

        <EmptyState
          v-if="sheet.rows.length === 0"
          icon="stats"
          title="还没有人参加考试"
          description="发布考试后，学员在课程详情页即可进入作答，交卷后成绩会出现在这里。"
        />

        <div v-else class="mc-table-wrap table-wrap">
          <table class="mc-table mc-table--compact">
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>得分</th>
                <th>结果</th>
                <th>用时</th>
                <th>交卷时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sheet.rows" :key="row.user_id">
                <td class="mc-mono">{{ row.username }}</td>
                <td>{{ row.display_name || '—' }}</td>
                <td>{{ fmtScore(row.score) }} / {{ fmtScore(row.total) }}</td>
                <td>
                  <span class="mc-badge" :class="row.passed === 1 ? 'mc-badge--success' : 'mc-badge--danger'">
                    {{ row.passed === 1 ? '及格' : '不及格' }}
                  </span>
                </td>
                <td>{{ formatSeconds(row.used_seconds) }}</td>
                <td class="mc-muted">{{ formatTime(row.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <EmptyState v-else icon="stats" title="暂时无法加载成绩单" description="请点击上方刷新重试。" />
    </div>
  </section>
</template>
