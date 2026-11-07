<script setup lang="ts">
/**
 * 总览 · 顶部 KPI：四张卡按语义域上色（课程=主色、课时=青、题目=靛、账号=中性）。
 * 数值全部来自 OverviewView 已取好的真实数据，这里只负责配色与网格。
 */
import { computed } from 'vue';
import StatCard from '@/components/StatCard.vue';
import type { IconName } from '@/components/icons';
import type { Course, User } from '@/api/types';

const props = defineProps<{
  courses: Course[];
  lessons: number;
  question: { value: string; unit: string };
  questionHint: string;
  users: User[];
  isAdmin: boolean;
}>();

interface Kpi {
  label: string;
  value: string | number;
  unit: string;
  icon: IconName;
  tone: 'primary' | 'cyan' | 'indigo' | 'neutral';
  hint: string;
}

const kpis = computed<Kpi[]>(() => [
  {
    label: '课程',
    value: props.courses.length,
    unit: '门',
    icon: 'courses',
    tone: 'primary',
    hint: `${props.courses.filter((c) => c.published).length} 门已发布`,
  },
  { label: '课时', value: props.lessons, unit: '个', icon: 'video', tone: 'cyan', hint: '含未归类视频' },
  {
    label: '题目',
    value: props.question.value,
    unit: props.question.unit,
    icon: 'bank',
    tone: 'indigo',
    hint: props.questionHint,
  },
  ...(props.isAdmin
    ? [
        {
          label: '账号',
          value: props.users.length,
          unit: '个',
          icon: 'users' as const,
          tone: 'neutral' as const,
          hint: `${props.users.filter((u) => u.role === 'student').length} 名学员`,
        },
      ]
    : []),
]);
</script>

<template>
  <div class="kpis">
    <StatCard
      v-for="kpi in kpis"
      :key="kpi.label"
      :label="kpi.label"
      :value="kpi.value"
      :unit="kpi.unit"
      :icon="kpi.icon"
      :tone="kpi.tone"
      :hint="kpi.hint"
    />
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--mc-space-4);
}
</style>
