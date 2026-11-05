<script setup lang="ts">
/**
 * 总览仪表盘（教师/管理员落地页）。
 *
 * 设计取舍：
 *  - 「需要你处理」是这一页的重点 —— 把系统里**客观存在的数据问题**变成可点的待办，
 *    而不是让老师在各个页面之间自己找（冲突题、未标难度、解析纯图片、未归类课时、重复题）；
 *  - 数据来源全部走**轻查询或服务端缓存**：`/courses`（含未归类课时计数）、
 *    `/question-conflicts`（读台账）、`/banks/health`（服务端 5 分钟缓存，`cachedAt` 会显示出来），
 *    `/users` 仅管理员可见；重查询不阻塞首屏（卡片各自独立加载）。
 */
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import MetricBar from '@/components/MetricBar.vue';
import LinksCard from './overview/LinksCard.vue';
import TodoCard from './overview/TodoCard.vue';
import type { IconName } from '@/components/icons';
import type { Course, Category, User } from '@/api/types';

const auth = useAuthStore();
const toast = useToastStore();

interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

interface HealthResponse {
  scope: { bankId: number | null; name: string };
  stats: {
    total: number;
    missingDifficulty: number;
    emptyAnswer: number;
    mediaOnlyAnalysis: number;
    duplicateGroups: number;
    duplicateQuestions: number;
    conflictGroups: number;
    noFingerprint: number;
  };
  cachedAt: number;
}

interface ConflictsResponse {
  counts: { pending: number; resolved: number; ignored: number; total: number };
}

interface Todo {
  key: string;
  label: string;
  count: number;
  hint: string;
  to: string;
  icon: IconName;
  tone: 'warning' | 'danger' | 'info' | 'primary' | 'neutral';
}

const courses = ref<Course[]>([]);
const orphans = ref<CoursesResponse['orphans']>({ total: 0, finished: 0, quiz: 0 });
const health = ref<HealthResponse | null>(null);
const conflicts = ref<ConflictsResponse['counts'] | null>(null);
const users = ref<User[]>([]);
const loading = ref(true);
const healthLoading = ref(false);
const healthError = ref('');

const lessonsTotal = ref(0);

async function loadCore(): Promise<void> {
  loading.value = true;
  try {
    const [coursesRes, conflictRes] = await Promise.all([
      api.get<CoursesResponse>('/courses'),
      api.get<ConflictsResponse>('/question-conflicts', { status: 'pending', pageSize: 1 }),
    ]);
    courses.value = coursesRes.courses;
    orphans.value = coursesRes.orphans;
    conflicts.value = conflictRes.counts;
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }

  // 学员数只有管理员能看；失败也不该影响整页
  if (auth.isAdmin) {
    try {
      const res = await api.get<{ users: User[] }>('/users');
      users.value = res.users;
    } catch {
      users.value = [];
    }
  }
  try {
    const res = await api.get<{ lessons: { id: number }[]; total?: number }>('/lessons', {});
    lessonsTotal.value = res.total ?? res.lessons.length;
  } catch {
    lessonsTotal.value = 0;
  }
}

/** 体检数据：走服务端 5 分钟缓存；只有点「重新体检」才显式 refresh=1 */
async function loadHealth(refresh = false): Promise<void> {
  healthLoading.value = true;
  healthError.value = '';
  try {
    health.value = await api.get<HealthResponse>('/banks/health', { limit: 5, ...(refresh ? { refresh: 1 } : {}) });
  } catch (e) {
    healthError.value = errorMessage(e);
  } finally {
    healthLoading.value = false;
  }
}

function fmtTime(seconds: number): string {
  if (!seconds) return '—';
  const d = new Date(seconds);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todosOf(): Todo[] {
  const list: Todo[] = [];
  const pending = conflicts.value?.pending ?? 0;
  if (pending > 0)
    list.push({
      key: 'conflict',
      label: '同题不同答案待核对',
      count: pending,
      hint: '题干与选项相同但答案不一致，需要人工定一个',
      to: '/admin/question-conflicts',
      icon: 'conflict',
      tone: 'danger',
    });
  const missing = health.value?.stats.missingDifficulty ?? 0;
  if (missing > 0)
    list.push({
      key: 'difficulty',
      label: '题目未标难度',
      count: missing,
      hint: '旧的粗标数据，可在题库体检里一键重算',
      to: '/admin/banks',
      icon: 'target',
      tone: 'warning',
    });
  const mediaOnly = health.value?.stats.mediaOnlyAnalysis ?? 0;
  if (mediaOnly > 0)
    list.push({
      key: 'media',
      label: '解析只有图片（图片里是文字）',
      count: mediaOnly,
      hint: '解析正文为空、只剩一张截图，无法检索也不利于打印',
      to: '/admin/banks',
      icon: 'image',
      tone: 'warning',
    });
  const dup = health.value?.stats.duplicateGroups ?? 0;
  if (dup > 0)
    list.push({
      key: 'duplicate',
      label: '重复题分组',
      count: dup,
      hint: '同一道题出现在多份题库里（不同导入来源常见），可按库清理或忽略',
      to: '/admin/banks',
      icon: 'copy',
      tone: 'neutral',
    });
  if (orphans.value.total > 0)
    list.push({
      key: 'orphan',
      label: '未归类课时',
      count: orphans.value.total,
      hint: '视频已上传但没挂到课程章节里',
      to: '/admin/courses',
      icon: 'video',
      tone: 'primary',
    });
  return list;
}

/** 体检数据没回来时显示「—」：显示 0 会被误读成"题库是空的" */
const questionStat = computed(() =>
  health.value ? { value: String(health.value.stats.total), unit: '题' } : { value: '—', unit: '' },
);

/** 顶部指标条（反模式 #20：四个数字不该占四张卡） */
const metrics = computed(() => [
  { label: '课程', value: courses.value.length, unit: '门', tone: 'primary' as const },
  { label: '课时', value: lessonsTotal.value, unit: '个', tone: 'info' as const },
  {
    label: '题目',
    value: questionStat.value.value,
    unit: questionStat.value.unit,
    hint: healthHint.value,
  },
  ...(auth.isAdmin
    ? [
        {
          label: '账号',
          value: users.value.length,
          unit: '个',
          hint: `${users.value.filter((u) => u.role === 'student').length} 名学员`,
        },
      ]
    : []),
]);

const healthHint = computed(() => {
  if (healthLoading.value && !health.value) return '体检数据加载中…';
  if (!health.value) return healthError.value ? '体检数据加载失败' : '体检数据待加载';
  return `题库体检缓存于 ${fmtTime(health.value.cachedAt)}`;
});

onMounted(async () => {
  await loadCore();
  await loadHealth();
});
</script>

<template>
  <section class="page mc-col overview">
    <PageHeader
      title="总览"
      description="站点关键数据与需要处理的事项。数据问题做成待办，点进去直接处理。"
      icon="grid"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '教学管理' }, { label: '总览' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="healthLoading" @click="loadHealth(true)">
          <Icon name="shield" :size="15" />
          {{ healthLoading ? '体检中…' : '重新体检' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="loadCore()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
      </template>

      <template #meta>
        <!-- 反模式 #20：四个数字不必占四张卡片 -->
        <MetricBar :items="metrics" />
      </template>
    </PageHeader>

    <TodoCard
      :todos="todosOf()"
      :loading="loading"
      :health-error="healthError"
      :health-loading="healthLoading"
      :cached-text="health ? fmtTime(health.cachedAt) : ''"
    />

    <LinksCard :is-admin="auth.isAdmin" />
  </section>
</template>

<style scoped>
/* 后台区块之间 32；页头自带的 24 外边距在总览里让位给统一 gap */
.overview {
  gap: var(--mc-space-8);
}

.overview :deep(.ph) {
  margin-bottom: 0;
}
</style>
