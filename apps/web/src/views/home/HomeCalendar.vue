<script setup lang="ts">
/**
 * 首页 · 学习日历：近 30 天热力格（周一开头，7 列），右侧与「今日待办」并排。
 *
 * - 有活动 = 主色深浅三档（按当天 lessons+quizzes 数量）；
 * - 无活动 = 浅灰；窗口外补位格透明，不冒充「没学习」；
 * - 今天有活动时格子加主色描边（同一行/列的高亮对比度靠 offset 留白保证）；
 * - 下方一行统计「近 30 天学习 N 天 · 连续 M 天」，没有记录时给去大厅的入口。
 */
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import SectionHead from '@/components/SectionHead.vue';
import { useLearningActivity } from '@/composables/use-learning-activity';
import { cellLabel, type CalendarCell } from '@/utils/learning-activity';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const { calendar, loading, load } = useLearningActivity(30);

const ariaLabel = computed(
  () => `近 30 天学习热力图：${calendar.value.activeDays} 天有学习记录，连续 ${calendar.value.streak} 天`,
);

function cellClass(cell: CalendarCell): (string | false)[] {
  return [
    `cal__cell--l${cell.level}`,
    !cell.date && 'cal__cell--blank',
    cell.today && cell.level > 0 && 'cal__cell--today',
  ];
}

onMounted(() => void load());
</script>

<template>
  <section class="cal" aria-label="学习日历">
    <SectionHead title="学习日历" icon="flame">
      <template #meta>近 30 天</template>
    </SectionHead>

    <div class="cal__card">
      <div class="cal__head" aria-hidden="true">
        <span v-for="weekday in WEEKDAYS" :key="weekday" class="cal__weekday">{{ weekday }}</span>
      </div>

      <div class="cal__grid" role="img" :aria-label="ariaLabel">
        <span
          v-for="(cell, index) in calendar.cells"
          :key="cell.date ?? `blank-${index}`"
          class="cal__cell"
          :class="cellClass(cell)"
          :title="cell.date ? `${cellLabel(cell)}：学习 ${cell.lessons + cell.quizzes} 项` : undefined"
        />
      </div>

      <p v-if="calendar.hasActivity" class="cal__stat">
        近 30 天学习 <strong class="mc-num">{{ calendar.activeDays }}</strong> 天 · 连续
        <strong class="mc-num">{{ calendar.streak }}</strong> 天
      </p>
      <p v-else-if="loading" class="cal__stat">正在读取学习记录…</p>
      <p v-else class="cal__empty">
        还没有学习记录，<RouterLink class="cal__link" to="/hall">去看一门课吧</RouterLink>
      </p>
    </div>
  </section>
</template>

<style scoped>
.cal__card {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
}

.cal__head,
.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--mc-space-1);
}

.cal__weekday {
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-tight);
  color: var(--mc-text-muted);
  text-align: center;
}

.cal__cell {
  height: var(--mc-space-10);
  border: 1px solid transparent;
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-sunken);
}

/* 窗口外补位：透明，不参与「有没有学习」的读图 */
.cal__cell--blank {
  background: transparent;
}

.cal__cell--l1 {
  background: color-mix(in srgb, var(--mc-primary) 18%, var(--mc-bg-elevated));
}

.cal__cell--l2 {
  background: color-mix(in srgb, var(--mc-primary) 45%, var(--mc-bg-elevated));
}

.cal__cell--l3 {
  background: var(--mc-primary);
}

/* 今天有活动：主色描边 + offset 留白，深色格子上也能看出来 */
.cal__cell--today {
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
}

.cal__stat,
.cal__empty {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text-muted);
}

.cal__stat strong {
  font-size: var(--mc-text-sm);
  color: var(--mc-text);
}

.cal__link {
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.cal__link:hover {
  text-decoration: underline;
}
</style>
