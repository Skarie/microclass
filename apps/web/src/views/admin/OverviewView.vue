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
import { useBankHealthPoll } from '@/composables/use-bank-health-poll';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import LinksCard from './overview/LinksCard.vue';
import TodoCard from './overview/TodoCard.vue';
import OverviewKpis from './overview/OverviewKpis.vue';
import type { IconName } from '@/components/icons';
import type { Course, Category, User } from '@/api/types';

const auth = useAuthStore();
const toast = useToastStore();

interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
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
/** 体检：持久缓存 + 后台 worker（迁移 0031）；冷缓存先回 202，组件自动轮询 */
const healthPoll = useBankHealthPoll({ limit: 5 });
const health = healthPoll.health;
const healthComputing = healthPoll.computing;
const conflicts = ref<ConflictsResponse['counts'] | null>(null);
const users = ref<User[]>([]);
const loading = ref(true);
const healthLoading = computed(() => healthPoll.loading.value);
const healthError = healthPoll.error;

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

/** 体检数据：走服务端持久缓存 + 后台 worker（迁移 0031）；「重新体检」= refresh=1 强制重算 */
async function loadHealth(refresh = false): Promise<void> {
  await healthPoll.load(refresh);
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

const healthHint = computed(() => {
  if (health.value) return `题库体检缓存于 ${fmtTime(health.value.cachedAt)}`;
  if (healthComputing.value) return '体检计算中（后台进行）…';
  if (healthLoading.value) return '体检数据加载中…';
  if (healthError.value) return '体检数据加载失败';
  return '体检数据待加载';
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
        <button
          class="mc-btn mc-btn--sm"
          type="button"
          :disabled="healthLoading || healthComputing"
          @click="loadHealth(true)"
        >
          <Icon name="shield" :size="16" />
          {{ healthComputing ? '体检计算中…' : healthLoading ? '体检中…' : '重新体检' }}
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="loadCore()">
          <Icon name="refresh" :size="16" />
          刷新
        </button>
      </template>
    </PageHeader>

    <!-- 冷缓存时接口回 202（后台 worker 计算中）：明确告诉老师「可继续操作」，完成后自动刷新 -->
    <p v-if="healthComputing" class="overview__note">
      <Icon name="shield" :size="16" />
      体检计算中（后台进行，可继续操作），完成后本页数字自动刷新；也可以先去处理其他事项。
    </p>

    <div class="overview__kpis">
      <OverviewKpis
        :courses="courses"
        :lessons="lessonsTotal"
        :question="questionStat"
        :question-hint="healthHint"
        :users="users"
        :is-admin="auth.isAdmin"
      />
    </div>

    <TodoCard
      :todos="todosOf()"
      :loading="loading"
      :health-error="healthError"
      :health-loading="healthLoading"
      :health-computing="healthComputing"
      :cached-text="health ? fmtTime(health.cachedAt) : ''"
      @retry="loadHealth(true)"
    />

    <LinksCard :is-admin="auth.isAdmin" />
  </section>
</template>

<style scoped>
/* 后台区块之间 32；页头自带的 24 外边距在总览里让位给统一 gap */
.overview {
  gap: var(--mc-space-8);
}

.overview__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--mc-space-4);
}

/* 202「体检计算中」提示条：主色软底，不是错误 */
.overview__note {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  padding: var(--mc-space-3) var(--mc-space-4);
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-relaxed);
}

.overview :deep(.ph) {
  margin-bottom: 0;
}
</style>
