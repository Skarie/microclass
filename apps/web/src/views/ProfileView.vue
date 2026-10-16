<script setup lang="ts">
/**
 * 个人中心：学习概览（等级进度）、考试成绩、刷题记录与修改密码。
 */
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage, useAsync } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { Attempt, Summary } from '@/api/types';

interface MyExamRow {
  exam_id: number;
  exam_title: string;
  course_id: number;
  course_name: string;
  score: number;
  total: number;
  passed: 0 | 1;
  used_seconds: number;
  created_at: number;
}

interface MyExamsResponse {
  exams: MyExamRow[];
  exam_summary: { attempts: number; passed: number; avg: number };
}

interface MyAttemptsResponse {
  attempts: Attempt[];
}

/** 与后端 LEVELS 阈值保持一致，仅用于计算“距离下一等级”的进度条 */
const LEVEL_MINUTES: readonly number[] = [0, 10, 60, 180, 420];

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

const refreshing = ref(false);
const pwdOld = ref('');
const pwdNew = ref('');
const pwdConfirm = ref('');
const pwdSaving = ref(false);
const loggingOut = ref(false);

const {
  data: summary,
  loading: summaryLoading,
  run: runSummary,
} = useAsync<Summary>(() => api.get<Summary>('/me/summary'));
const {
  data: examData,
  loading: examsLoading,
  run: runExams,
} = useAsync<MyExamsResponse>(() => api.get<MyExamsResponse>('/me/exams'));
const {
  data: attemptData,
  loading: attemptsLoading,
  run: runAttempts,
} = useAsync<MyAttemptsResponse>(() => api.get<MyAttemptsResponse>('/me/attempts', { limit: 50 }));

const exams = computed<MyExamRow[]>(() => examData.value?.exams ?? []);
const examSummary = computed(() => examData.value?.exam_summary ?? { attempts: 0, passed: 0, avg: 0 });
const attempts = computed<Attempt[]>(() => attemptData.value?.attempts ?? []);
const nextMinutes = computed(() => summary.value?.nextMinutes ?? null);

/** 等级进度：当前等级阈值到下一等级阈值之间的百分比（已满级为 100%） */
const levelPercent = computed(() => {
  const s = summary.value;
  if (!s) return 0;
  const next = s.nextMinutes;
  if (next === null) return 100;
  const current = [...LEVEL_MINUTES].reverse().find((m) => m <= s.minutes) ?? 0;
  const span = next - current;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((s.minutes - current) / span) * 100)));
});

const newPasswordError = computed(() => {
  if (!pwdNew.value) return '';
  if (pwdNew.value.length < 6) return '新密码至少 6 位';
  if (pwdOld.value && pwdNew.value === pwdOld.value) return '新密码不能与原密码相同';
  return '';
});

const confirmPasswordError = computed(() =>
  pwdConfirm.value && pwdConfirm.value !== pwdNew.value ? '两次输入的新密码不一致' : '',
);

const canSubmitPassword = computed(
  () =>
    pwdOld.value.trim() !== '' &&
    pwdNew.value.length >= 6 &&
    pwdNew.value !== pwdOld.value &&
    pwdConfirm.value === pwdNew.value,
);

function percent(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function formatTime(ms: number): string {
  return new Date(ms * 1000).toLocaleString('zh-CN');
}

/** 秒 → mm:ss */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function refreshAll(): Promise<void> {
  refreshing.value = true;
  try {
    await Promise.all([runSummary(true), runExams(true), runAttempts(true)]);
    toast.success('数据已刷新');
  } finally {
    refreshing.value = false;
  }
}

async function submitPassword(): Promise<void> {
  if (!canSubmitPassword.value) {
    toast.warning(newPasswordError.value || confirmPasswordError.value || '请完整填写密码信息');
    return;
  }
  pwdSaving.value = true;
  try {
    await auth.changePassword(pwdOld.value, pwdNew.value);
    toast.success('密码已更新，请使用新密码登录');
    pwdOld.value = '';
    pwdNew.value = '';
    pwdConfirm.value = '';
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    pwdSaving.value = false;
  }
}

async function logout(): Promise<void> {
  if (!window.confirm('确定要退出登录吗？')) return;
  loggingOut.value = true;
  try {
    await auth.logout();
    toast.success('已退出登录');
    await router.push({ name: 'login' });
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <section class="profile mc-col">
    <PageHeader
      title="个人中心"
      :description="`${auth.displayName || auth.user?.username || '同学'} · 累计学习与考试数据都在这里汇总。`"
      icon="user"
      :breadcrumb="[{ label: '课程大厅', to: '/' }, { label: '个人中心' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="refreshing" @click="refreshAll">
          <Icon name="refresh" :size="15" />
          {{ refreshing ? '刷新中…' : '刷新数据' }}
        </button>
        <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'wrong-book' }">
          <Icon name="wrong" :size="15" />
          错题本
        </RouterLink>
        <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" :disabled="loggingOut" @click="logout">
          退出登录
        </button>
      </template>
    </PageHeader>

    <!-- (a) 学习概览 -->
    <div class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">学习概览</span>
        <span class="mc-badge mc-badge--primary">{{ summary?.level ?? '—' }}</span>
      </div>
      <div class="mc-card__body mc-col">
        <div v-if="summaryLoading && !summary" class="mc-grid mc-grid--stats">
          <div v-for="n in 4" :key="n" class="mc-skeleton" style="height: 72px" />
        </div>
        <template v-else>
          <div class="mc-grid mc-grid--stats">
            <div class="stat">
              <span class="mc-muted stat__label">累计学习时长</span>
              <span class="stat__value">{{ summary?.minutes ?? 0 }} <small>分钟</small></span>
            </div>
            <div class="stat">
              <span class="mc-muted stat__label">已学完课时</span>
              <span class="stat__value">{{ summary?.finishedLessons ?? 0 }} <small>个</small></span>
            </div>
            <div class="stat">
              <span class="mc-muted stat__label">已练习课时</span>
              <span class="stat__value">{{ summary?.quizzed ?? 0 }} <small>个</small></span>
            </div>
            <div class="stat">
              <span class="mc-muted stat__label">当前等级</span>
              <span class="stat__value stat__value--text">{{ summary?.level ?? '—' }}</span>
            </div>
          </div>

          <div class="level mc-col">
            <div class="mc-row mc-row--between">
              <span class="mc-label">距离下一等级</span>
              <span class="mc-muted">
                <template v-if="nextMinutes !== null">
                  还需 {{ Math.max(0, nextMinutes - (summary?.minutes ?? 0)) }} 分钟（目标 {{ nextMinutes }} 分钟）
                </template>
                <template v-else>已达最高等级，继续保持！</template>
              </span>
            </div>
            <div
              class="mc-progress"
              role="progressbar"
              aria-label="距离下一等级的进度"
              :aria-valuenow="levelPercent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="mc-progress__bar"
                :class="{ 'mc-progress__bar--success': levelPercent >= 100 }"
                :style="{ width: `${levelPercent}%` }"
              />
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- (b) 考试成绩 -->
    <div class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">考试成绩</span>
        <span class="mc-muted">
          共 {{ examSummary.attempts }} 场 · 通过 {{ examSummary.passed }} 场 · 平均 {{ examSummary.avg }} 分
        </span>
      </div>
      <div class="mc-card__body">
        <div v-if="examsLoading && exams.length === 0" class="mc-col">
          <div class="mc-skeleton" style="height: 96px" />
        </div>
        <EmptyState
          v-else-if="exams.length === 0"
          icon="stats"
          title="还没有考试记录"
          description="在课程详情页进入在线考试，交卷后成绩会显示在这里。"
        />
        <div v-else class="mc-table-wrap">
          <table class="mc-table" aria-label="我的考试成绩">
            <thead>
              <tr>
                <th scope="col">考试</th>
                <th scope="col">所属课程</th>
                <th scope="col">得分</th>
                <th scope="col">得分率</th>
                <th scope="col">结果</th>
                <th scope="col">用时</th>
                <th scope="col">交卷时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in exams" :key="row.exam_id">
                <td>{{ row.exam_title }}</td>
                <td class="mc-truncate">{{ row.course_name }}</td>
                <td class="mc-mono">{{ row.score }} / {{ row.total }}</td>
                <td class="mc-mono">{{ percent(row.score, row.total) }}%</td>
                <td>
                  <span class="mc-badge" :class="row.passed === 1 ? 'mc-badge--success' : 'mc-badge--danger'">
                    {{ row.passed === 1 ? '通过' : '未通过' }}
                  </span>
                </td>
                <td class="mc-mono">{{ formatDuration(row.used_seconds) }}</td>
                <td class="mc-muted">{{ formatTime(row.created_at) }}</td>
                <td>
                  <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'exam-result', params: { id: row.exam_id } }">
                    查看复盘
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- (c) 刷题记录 -->
    <div class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">刷题记录</span>
        <span class="mc-muted">最近 {{ attempts.length }} 条（最多 50 条）</span>
      </div>
      <div class="mc-card__body">
        <div v-if="attemptsLoading && attempts.length === 0" class="mc-col">
          <div class="mc-skeleton" style="height: 96px" />
        </div>
        <EmptyState
          v-else-if="attempts.length === 0"
          icon="pen-line"
          title="还没有刷题记录"
          description="进入任意课时的「课后练习」作答，提交后会生成记录与最好成绩。"
        />
        <div v-else class="mc-table-wrap">
          <table class="mc-table" aria-label="我的刷题记录">
            <thead>
              <tr>
                <th scope="col">课时</th>
                <th scope="col">得分</th>
                <th scope="col">得分率</th>
                <th scope="col">时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in attempts" :key="row.id">
                <td class="mc-truncate">{{ row.lesson_title || `课时 #${row.lesson_id}` }}</td>
                <td class="mc-mono">{{ row.score }} / {{ row.total }}</td>
                <td class="mc-mono">{{ percent(row.score, row.total) }}%</td>
                <td class="mc-muted">{{ formatTime(row.created_at) }}</td>
                <td>
                  <RouterLink class="mc-btn mc-btn--sm" :to="{ name: 'quiz', params: { id: row.lesson_id } }">
                    再练一次
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- (d) 修改密码 -->
    <div class="mc-card">
      <div class="mc-card__header">
        <span class="mc-card__title">修改密码</span>
        <span class="mc-muted">修改后请使用新密码登录</span>
      </div>
      <div class="mc-card__body">
        <form class="pwd" novalidate @submit.prevent="submitPassword">
          <div class="pwd__grid">
            <div class="mc-field">
              <label class="mc-label mc-label--required" for="pwd-old">原密码</label>
              <input
                id="pwd-old"
                v-model="pwdOld"
                class="mc-input"
                type="password"
                autocomplete="current-password"
                placeholder="请输入当前密码"
              />
            </div>
            <div class="mc-field">
              <label class="mc-label mc-label--required" for="pwd-new">新密码</label>
              <input
                id="pwd-new"
                v-model="pwdNew"
                class="mc-input"
                type="password"
                autocomplete="new-password"
                placeholder="至少 6 位"
                :aria-invalid="newPasswordError !== ''"
                aria-describedby="pwd-new-hint"
              />
              <span id="pwd-new-hint" class="mc-hint" :class="{ 'mc-error-text': newPasswordError !== '' }">
                {{ newPasswordError || '新密码至少 6 位，且不能与原密码相同' }}
              </span>
            </div>
            <div class="mc-field">
              <label class="mc-label mc-label--required" for="pwd-confirm">确认新密码</label>
              <input
                id="pwd-confirm"
                v-model="pwdConfirm"
                class="mc-input"
                type="password"
                autocomplete="new-password"
                placeholder="请再次输入新密码"
                :aria-invalid="confirmPasswordError !== ''"
                aria-describedby="pwd-confirm-hint"
              />
              <span id="pwd-confirm-hint" class="mc-hint" :class="{ 'mc-error-text': confirmPasswordError !== '' }">
                {{ confirmPasswordError || '两次输入需要保持一致' }}
              </span>
            </div>
          </div>
          <div class="mc-row mc-row--between pwd__footer">
            <span class="mc-muted">修改成功后当前登录状态保留。</span>
            <button class="mc-btn mc-btn--primary" type="submit" :disabled="pwdSaving || !canSubmitPassword">
              {{ pwdSaving ? '提交中…' : '保存新密码' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.profile__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-5);
  padding: var(--mc-space-5);
}

.profile__head-main {
  gap: var(--mc-space-2);
  min-width: 0;
}

.profile__title {
  font-size: var(--mc-text-lg);
}

.profile__hint {
  margin: 0;
  font-size: var(--mc-text-sm);
}

.profile__head-actions {
  flex: none;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.stat__label {
  font-size: var(--mc-text-xs);
}

.stat__value {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
}

.stat__value--text {
  font-size: var(--mc-text-lg);
}

.stat__value small {
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.level {
  gap: var(--mc-space-2);
}

.pwd__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--mc-space-4);
}

.pwd__footer {
  margin-top: var(--mc-space-4);
  flex-wrap: wrap;
  gap: var(--mc-space-3);
}
</style>
