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
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
import Tag from '@/components/Tag.vue';
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
        <StatCard label="课程" :value="courses.length" unit="门" icon="courses" tone="primary" />
        <StatCard label="课时" :value="lessonsTotal" unit="个" icon="video" tone="info" />
        <StatCard
          label="题目"
          :value="questionStat.value"
          :unit="questionStat.unit"
          icon="bank"
          tone="neutral"
          :hint="healthHint"
        />
        <StatCard
          v-if="auth.isAdmin"
          label="账号"
          :value="users.length"
          unit="个"
          icon="users"
          tone="neutral"
          :hint="`${users.filter((u) => u.role === 'student').length} 名学员`"
        />
      </template>
    </PageHeader>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-row overview__cardtitle">
          <Icon name="alert" :size="16" />
          <span class="mc-card__title">需要处理</span>
        </span>
        <Tag v-if="todosOf().length === 0" tone="success" size="sm" icon="check">暂无待办</Tag>
        <div class="mc-spacer" />
        <span v-if="health" class="mc-muted">
          体检缓存时间 {{ fmtTime(health.cachedAt) }}
          <template v-if="healthLoading">（更新中…）</template>
        </span>
      </div>

      <div class="mc-card__body">
        <p v-if="healthError" class="mc-error-text">体检数据加载失败：{{ healthError }}</p>

        <p v-if="loading" class="mc-skeleton loading__row" />

        <div v-else-if="todosOf().length === 0" class="overview__clear">
          <Icon name="check-circle" :size="26" />
          <div>
            <div class="overview__clear-title">当前没有待处理的数据问题</div>
            <p class="mc-muted">冲突题已核对完、难度已标注、解析都有文字、课时都归好类。</p>
          </div>
        </div>

        <ul v-else class="overview__todos">
          <li v-for="todo in todosOf()" :key="todo.key" class="overview__todo">
            <span class="overview__todo-icon" :class="`overview__todo-icon--${todo.tone}`">
              <Icon :name="todo.icon" :size="18" />
            </span>
            <span class="overview__todo-body">
              <span class="overview__todo-label">{{ todo.label }}</span>
              <span class="mc-muted overview__todo-hint">{{ todo.hint }}</span>
            </span>
            <span class="overview__todo-count">{{ todo.count }}</span>
            <RouterLink class="mc-btn mc-btn--soft mc-btn--sm" :to="todo.to">
              去处理
              <Icon name="arrow-right" :size="14" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <section class="mc-card">
      <div class="mc-card__header">
        <span class="mc-row overview__cardtitle">
          <Icon name="courses" :size="16" />
          <span class="mc-card__title">常用入口</span>
        </span>
      </div>
      <div class="mc-card__body overview__links">
        <RouterLink class="overview__link" to="/admin/courses">
          <Icon name="courses" :size="18" />
          <span>课程与课时</span>
          <em>建课、上传视频、归类</em>
        </RouterLink>
        <RouterLink class="overview__link" to="/admin/banks">
          <Icon name="bank" :size="18" />
          <span>题库管理</span>
          <em>导入导出、体检、难度</em>
        </RouterLink>
        <RouterLink class="overview__link" to="/admin/exams">
          <Icon name="exam" :size="18" />
          <span>考试与组卷</span>
          <em>挑题排卷、成绩单</em>
        </RouterLink>
        <RouterLink class="overview__link" to="/admin/stats">
          <Icon name="stats" :size="18" />
          <span>学习统计</span>
          <em>观看时长与练习成绩</em>
        </RouterLink>
        <RouterLink class="overview__link" to="/admin/question-conflicts">
          <Icon name="conflict" :size="18" />
          <span>冲突题核对</span>
          <em>同题不同答案</em>
        </RouterLink>
        <RouterLink v-if="auth.isAdmin" class="overview__link" to="/admin/users">
          <Icon name="users" :size="18" />
          <span>学员与账号</span>
          <em>建号、改角色、审计</em>
        </RouterLink>
      </div>
    </section>
  </section>
</template>

<style scoped>
.overview__cardtitle {
  align-items: center;
  gap: var(--mc-space-2);
}

.overview__todos {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.overview__todo {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
}

.overview__todo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--mc-radius);
  flex: none;
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
}

.overview__todo-icon--danger {
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
}

.overview__todo-icon--warning {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}

.overview__todo-icon--info {
  background: var(--mc-info-soft);
  color: var(--mc-info-fg);
}

.overview__todo-icon--primary {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

.overview__todo-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.overview__todo-label {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text);
}

.overview__todo-hint {
  font-size: var(--mc-text-xs);
}

.overview__todo-count {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--mc-text);
  min-width: 3ch;
  text-align: right;
}

.overview__clear {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
  border-radius: var(--mc-radius);
  background: var(--mc-success-soft);
  color: var(--mc-success-fg);
}

.overview__clear-title {
  font-weight: var(--mc-font-semibold);
}

.overview__clear p {
  margin: 4px 0 0;
}

.overview__links {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--mc-space-3);
}

.overview__link {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  color: var(--mc-text);
  transition:
    border-color var(--mc-duration) var(--mc-ease),
    box-shadow var(--mc-duration) var(--mc-ease),
    transform var(--mc-duration) var(--mc-ease-out);
}

.overview__link:hover {
  border-color: var(--mc-primary-border);
  box-shadow: var(--mc-elev-hover);
  transform: translateY(-1px);
}

.overview__link span {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.overview__link em {
  font-style: normal;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}
</style>
