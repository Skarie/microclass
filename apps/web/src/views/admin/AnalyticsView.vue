<script setup lang="ts">
/**
 * 学情分析（机构视角）：从**真实作答数据**看掌握情况，指导讲评与补课。
 *
 * 与「学习统计」的分工：
 *   - 学习统计：看视频/打卡/是否刷题（学习行为）；
 *   - 学情分析：作答正确率、知识点掌握度、高频错题、讲评清单（学习效果）。
 *
 * 三条界面原则：
 *   1. 顶部永远显示 `dataNote` —— 数据很少时明说"样本很少，结论仅供参考"，
 *      不能让机构拿一份几乎没数据的报表去做教学决策；
 *   2. 掌握度分档与后端阈值一致，**数据不足单独一档**，不混进"未掌握"；
 *   3. 空状态给"接下来做什么"的指引，而不是空白页。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { useRoute, useRouter } from 'vue-router';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import PageHeader from '@/components/PageHeader.vue';
import Toolbar from '@/components/Toolbar.vue';
import StatCard from '@/components/StatCard.vue';
import Tag from '@/components/Tag.vue';
import Icon from '@/components/Icon.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { BarItem } from '@/components/charts/types';
import DonutChart from '@/components/charts/DonutChart.vue';
import BarList from '@/components/charts/BarList.vue';
import TrendChart from '@/components/charts/TrendChart.vue';
import Sparkline from '@/components/charts/Sparkline.vue';
import ProgressRing from '@/components/charts/ProgressRing.vue';

interface CourseOption {
  id: number;
  name: string;
}

interface Overview {
  kpi: {
    students: number;
    activeStudents: number;
    graded: number;
    wrong: number;
    accuracy: number;
    practiceAttempts: number;
    examAttempts: number;
    questionsWithData: number;
    pointsWithData: number;
    totalQuestions: number;
    totalPoints: number;
    questionCoverage: number;
    pointCoverage: number;
  };
  trend: { day: string; graded: number; wrong: number; students: number; accuracy: number }[];
  mastery: { level: MasteryLevel; points: number }[];
  dataNote: string;
  generatedAt: number;
}

type MasteryLevel = 'mastered' | 'weak' | 'poor' | 'insufficient';

interface PointRow {
  point: string;
  graded: number;
  wrong: number;
  accuracy: number;
  students: number;
  questions: number;
  mastery: MasteryLevel;
  topWrong: { question_id: number; stem: string; graded: number; wrong: number }[];
}

interface StudentRow {
  user_id: number;
  username: string;
  display_name: string;
  graded: number;
  wrong: number;
  questions: number;
  points: number;
  weakest_point: string;
  weakest_wrong: number;
  accuracy: number;
  level: MasteryLevel;
}

interface WrongRow {
  question_id: number;
  stem: string;
  type: string;
  point: string;
  difficulty: string;
  graded: number;
  wrong: number;
  students: number;
  accuracy: number;
  score: number;
}

const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  poor: '未掌握',
  weak: '薄弱',
  mastered: '掌握',
  insufficient: '数据不足',
};
const MASTERY_TONE: Record<MasteryLevel, 'danger' | 'warning' | 'success' | 'neutral'> = {
  poor: 'danger',
  weak: 'warning',
  mastered: 'success',
  insufficient: 'neutral',
};
/** 掌握度图标：一眼看出好/差/数据不足（比只有文字颜色更直观） */
const MASTERY_ICON: Record<MasteryLevel, 'award' | 'alert' | 'close' | 'helpCircle'> = {
  mastered: 'award',
  weak: 'alert',
  poor: 'close',
  insufficient: 'helpCircle',
};

const tab = ref<'points' | 'students' | 'wrong' | 'trend'>('points');
const loading = ref(false);
const courses = ref<CourseOption[]>([]);
const filters = ref<{ courseId: number | ''; days: number }>({ courseId: '', days: 90 });
const minAttempts = ref(2);

const overview = ref<Overview | null>(null);
const points = ref<{ points: PointRow[]; dataNote: string } | null>(null);
const students = ref<{ students: StudentRow[]; dataNote: string } | null>(null);
const wrong = ref<{ questions: WrongRow[]; minAttempts: number; dataNote: string } | null>(null);
const expanded = ref<string | null>(null);

/** 展开的知识点（下面显示它的典型错题）；同时只展开一个，避免页面过长 */
const expandedPoints = computed(() => (points.value?.points ?? []).filter((p) => p.point === expanded.value));

/** 点条形榜某一行 → 展开/收起它的典型错题，并滚动定位到详情 */
function onPointSelect(key: string | number): void {
  const point = String(key);
  expanded.value = expanded.value === point ? null : point;
  void nextTick(() => {
    document.querySelector('.ana__detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

const scopeQuery = computed(() => ({
  ...(filters.value.courseId === '' ? {} : { courseId: filters.value.courseId }),
  ...(filters.value.days > 0 ? { days: filters.value.days } : {}),
}));

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function loadCourses(): Promise<void> {
  try {
    const res = await api.get<{ courses: CourseOption[] }>('/courses', { limit: 200 });
    courses.value = (res.courses ?? []).map((c) => ({ id: c.id, name: c.name }));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

async function loadOverview(): Promise<void> {
  overview.value = await api.get<Overview>('/analytics/overview', { ...scopeQuery.value, trendDays: 30 });
}

async function loadTab(): Promise<void> {
  if (tab.value === 'points') {
    points.value = await api.get<{ points: PointRow[]; dataNote: string }>('/analytics/points', {
      ...scopeQuery.value,
      limit: 50,
      questionsPerPoint: 3,
    });
  } else if (tab.value === 'students') {
    students.value = await api.get<{ students: StudentRow[]; dataNote: string }>('/analytics/students', {
      ...scopeQuery.value,
      limit: 50,
    });
  } else if (tab.value === 'wrong') {
    wrong.value = await api.get<{ questions: WrongRow[]; minAttempts: number; dataNote: string }>(
      '/analytics/wrong-questions',
      { ...scopeQuery.value, limit: 50, minAttempts: minAttempts.value },
    );
  }
}

async function loadAll(): Promise<void> {
  syncQuery();
  loading.value = true;
  try {
    await loadOverview();
    await loadTab();
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    loading.value = false;
  }
}

function switchTab(next: typeof tab.value): void {
  tab.value = next;
  void loadTab().catch((e: unknown) => toast.error(errorMessage(e)));
}

/** 导出讲评清单（Markdown）/ 高频错题（CSV）：后端设了 content-disposition，直接开新窗口下载 */
function exportFile(kind: 'review.md' | 'wrong-questions.csv'): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(scopeQuery.value)) params.set(key, String(value));
  if (kind === 'wrong-questions.csv') params.set('limit', '200');
  window.open(`/api/v1/analytics/${kind}?${params.toString()}`, '_blank');
}

/** 趋势序列（KPI 迷你图用） */
const trendSeries = computed(() => (overview.value?.trend ?? []).map((t) => t.graded));

/** 正确率迷你序列（0–100） */
const accuracySeries = computed(() => (overview.value?.trend ?? []).map((t) => Math.round(t.accuracy * 100)));

/** 掌握度知识点总数（环形图圆心用） */
const masteryTotal = computed(() => (overview.value?.mastery ?? []).reduce((sum, m) => sum + m.points, 0));

/** 掌握度环形图段 */
const masterySegments = computed(() =>
  (overview.value?.mastery ?? []).map((m) => ({
    label: MASTERY_LABEL[m.level],
    value: m.points,
    tone: MASTERY_TONE[m.level] === 'neutral' ? ('info' as const) : (MASTERY_TONE[m.level] as 'primary'),
    icon: MASTERY_ICON[m.level],
  })),
);

/** 知识点条形榜：条长 = 错误量，颜色按掌握度 */
const pointBars = computed<BarItem[]>(() =>
  (points.value?.points ?? []).map((p) => ({
    key: p.point,
    label: p.point,
    value: p.wrong,
    tone:
      p.mastery === 'poor'
        ? 'danger'
        : p.mastery === 'weak'
          ? 'warning'
          : p.mastery === 'mastered'
            ? 'success'
            : 'info',
    icon: MASTERY_ICON[p.mastery],
    valueText: pct(p.accuracy),
    hint: `${p.wrong} 错 / ${p.graded} 作答 · ${p.questions} 题`,
  })),
);

/** 学员条形榜：条长 = 错题数 */
const studentBars = computed<BarItem[]>(() =>
  (students.value?.students ?? []).map((s) => ({
    key: s.user_id,
    label: s.display_name || s.username,
    value: s.wrong,
    tone: s.level === 'poor' ? 'danger' : s.level === 'weak' ? 'warning' : 'success',
    icon: 'users',
    valueText: `${s.wrong} 题`,
    hint: `正确率 ${pct(s.accuracy)} · ${s.graded} 条作答${s.weakest_point ? ` · 最弱：${s.weakest_point}` : ''}`,
  })),
);

/** 高频错题条：**条长 = 错误率**（越长越该讲），颜色按严重程度 */
const wrongBars = computed<BarItem[]>(() =>
  (wrong.value?.questions ?? []).map((q) => {
    const errorRate = 1 - q.accuracy;
    return {
      key: q.question_id,
      label: q.stem,
      richText: true,
      value: Math.round(errorRate * 100),
      max: 100,
      tone: errorRate >= 0.5 ? 'danger' : errorRate >= 0.2 ? 'warning' : 'success',
      icon: 'flame',
      valueText: `错 ${Math.round(errorRate * 100)}%`,
      hint: `${q.graded} 次作答错 ${q.wrong} 次 · ${q.students} 人 · ${q.point || '未归类'}`,
    };
  }),
);

onMounted(async () => {
  // 支持深链：/admin/analytics?courseId=7&days=30（课程管理页可以「看这门课的学情」直接跳过来）
  const qCourse = Number.parseInt(String(route.query.courseId ?? ''), 10);
  if (!Number.isNaN(qCourse)) filters.value.courseId = qCourse;
  const qDays = Number.parseInt(String(route.query.days ?? ''), 10);
  if (!Number.isNaN(qDays) && [7, 30, 90, 0].includes(qDays)) filters.value.days = qDays;

  await loadCourses();
  await loadAll();
});

/** 切换筛选时把条件写回地址栏，便于分享与刷新后保持 */
function syncQuery(): void {
  void router.replace({
    query: {
      ...(filters.value.courseId === '' ? {} : { courseId: String(filters.value.courseId) }),
      ...(filters.value.days > 0 ? { days: String(filters.value.days) } : {}),
    },
  });
}
</script>

<template>
  <section class="page mc-col">
    <PageHeader
      title="学情分析"
      description="用真实作答数据看掌握情况：哪些知识点没掌握、哪些题错得多、讲评该讲什么。"
      icon="target"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="loadAll">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="exportFile('review.md')">
          <Icon name="download" :size="15" />
          讲评清单
        </button>
        <button class="mc-btn mc-btn--sm" type="button" @click="exportFile('wrong-questions.csv')">
          <Icon name="download" :size="15" />
          高频错题 CSV
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <label class="ana__field">
        <span class="mc-label">课程</span>
        <select v-model="filters.courseId" class="mc-select" aria-label="选择课程" @change="loadAll">
          <option value="">全部课程（机构视角）</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <label class="ana__field">
        <span class="mc-label">时间范围</span>
        <select v-model.number="filters.days" class="mc-select" aria-label="时间范围" @change="loadAll">
          <option :value="7">最近 7 天</option>
          <option :value="30">最近 30 天</option>
          <option :value="90">最近 90 天</option>
          <option :value="0">全部历史</option>
        </select>
      </label>
      <span class="mc-spacer" />
      <span v-if="overview" class="mc-muted ana__stamp">
        统计于 {{ new Date(overview.generatedAt).toLocaleTimeString('zh-CN') }}（缓存 1 分钟）
      </span>
    </Toolbar>

    <!-- 数据规模说明：永远显示，样本少时用警示色，避免误读 -->
    <div v-if="overview" class="ana__note" :class="{ 'ana__note--warn': overview.kpi.graded < 30 }">
      <Icon :name="overview.kpi.graded < 30 ? 'alert' : 'info'" :size="16" />
      <span>{{ overview.dataNote }}</span>
    </div>

    <div v-if="overview" class="ana__kpis">
      <StatCard
        label="活跃学员"
        :value="overview.kpi.activeStudents"
        :unit="`/ ${overview.kpi.students} 人`"
        icon="users"
        tone="primary"
        hint="最近范围内有作答的学员"
      >
        <template #visual>
          <ProgressRing
            :value="overview.kpi.students > 0 ? overview.kpi.activeStudents / overview.kpi.students : 0"
            :label="`活跃率 ${overview.kpi.students > 0 ? Math.round((overview.kpi.activeStudents / overview.kpi.students) * 100) : 0}%`"
            tone="info"
          />
        </template>
      </StatCard>
      <StatCard
        label="作答条目"
        :value="overview.kpi.graded"
        icon="chartBar"
        :hint="`练习 ${overview.kpi.practiceAttempts} 次 · 考试 ${overview.kpi.examAttempts} 次`"
      >
        <template #visual>
          <Sparkline :values="trendSeries" tone="primary" />
          <span class="mc-muted ana__sparkhint">近 30 天走势</span>
        </template>
      </StatCard>
      <StatCard
        label="整体正确率"
        :value="pct(overview.kpi.accuracy)"
        icon="check"
        :tone="overview.kpi.accuracy >= 0.8 ? 'success' : overview.kpi.accuracy >= 0.6 ? 'warning' : 'danger'"
        :hint="`错 ${overview.kpi.wrong} 条`"
      >
        <template #visual>
          <ProgressRing
            :value="overview.kpi.accuracy"
            :tone="overview.kpi.accuracy >= 0.8 ? 'success' : overview.kpi.accuracy >= 0.6 ? 'warning' : 'danger'"
            :label="`整体正确率 ${pct(overview.kpi.accuracy)}`"
          />
          <Sparkline :values="accuracySeries" tone="success" />
        </template>
      </StatCard>
      <StatCard
        label="题目覆盖"
        :value="`${overview.kpi.questionCoverage}%`"
        icon="bank"
        :hint="`${overview.kpi.questionsWithData} / ${overview.kpi.totalQuestions} 题有作答数据`"
      >
        <template #visual>
          <ProgressRing
            :value="overview.kpi.questionCoverage / 100"
            tone="info"
            :text="`${overview.kpi.questionCoverage}%`"
            :label="`题目覆盖率 ${overview.kpi.questionCoverage}%`"
          />
        </template>
      </StatCard>
      <StatCard
        label="知识点覆盖"
        :value="`${overview.kpi.pointCoverage}%`"
        icon="target"
        :hint="`${overview.kpi.pointsWithData} / ${overview.kpi.totalPoints} 个知识点`"
      >
        <template #visual>
          <ProgressRing
            :value="overview.kpi.pointCoverage / 100"
            tone="primary"
            :text="`${overview.kpi.pointCoverage}%`"
            :label="`知识点覆盖率 ${overview.kpi.pointCoverage}%`"
          />
        </template>
      </StatCard>
    </div>

    <div v-if="overview" class="mc-card ana__mastery">
      <div class="mc-card__title-row">
        <span class="mc-card__title">掌握度分布</span>
        <span class="mc-muted ana__titlehint">环形面积 = 知识点占比，图标 = 该档结论</span>
      </div>
      <DonutChart
        :segments="masterySegments"
        :center-value="masteryTotal"
        center-label="个知识点"
        :caption="`掌握度分布：${masterySegments.map((s) => `${s.label} ${s.value} 个`).join('，')}（共 ${masteryTotal} 个）`"
      />
      <p class="mc-hint">
        分档口径：作答 ≥ 3 次才下结论；正确率 ≥ 80% 为掌握、60–80% 为薄弱、&lt; 60% 为未掌握；不足 3
        次统一标为「数据不足」。
      </p>
    </div>

    <div class="ana__tabs" role="tablist">
      <button
        v-for="t in [
          { key: 'points', label: '知识点掌握度', icon: 'chartBar' },
          { key: 'students', label: '学员学情', icon: 'users' },
          { key: 'wrong', label: '高频错题', icon: 'flame' },
          { key: 'trend', label: '作答趋势', icon: 'trendingUp' },
        ]"
        :key="t.key"
        class="ana__tab"
        :class="{ 'is-active': tab === t.key }"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        @click="switchTab(t.key as typeof tab)"
      >
        <Icon :name="t.icon as never" :size="15" />
        {{ t.label }}
      </button>
    </div>

    <!-- 知识点掌握度 -->
    <div v-if="tab === 'points'" class="mc-card ana__panel">
      <template v-if="points && points.points.length > 0">
        <div class="mc-card__title-row">
          <span class="mc-card__title">薄弱知识点优先（条长 = 错误量，颜色 = 掌握度）</span>
          <span class="mc-muted ana__titlehint">点一行展开典型错题</span>
        </div>
        <BarList :items="pointBars" :limit="15" clickable caption="知识点掌握度条形榜" @select="onPointSelect" />
        <div v-for="p in expandedPoints" :key="`d-${p.point}`" class="ana__detail">
          <div class="mc-label">
            <Icon :name="MASTERY_ICON[p.mastery]" :size="14" />
            {{ p.point }} 的典型错题
            <Tag :tone="MASTERY_TONE[p.mastery]" size="sm">{{ MASTERY_LABEL[p.mastery] }}</Tag>
            <span class="mc-muted">{{ p.wrong }} 错 / {{ p.graded }} 作答 · 正确率 {{ pct(p.accuracy) }}</span>
          </div>
          <ul class="ana__wronglist">
            <li v-for="q in p.topWrong" :key="q.question_id">
              <span class="mc-muted">#{{ q.question_id }}</span>
              <RichText inline :text="q.stem" />
              <em class="mc-muted">（{{ q.graded }} 次作答错 {{ q.wrong }} 次）</em>
            </li>
            <li v-if="p.topWrong.length === 0" class="mc-muted">还没有错题记录</li>
          </ul>
        </div>
        <p class="mc-hint">{{ points.dataNote }}</p>
      </template>
      <EmptyState
        v-else
        icon="target"
        title="还没有知识点维度的作答数据"
        description="需要两件事：题目先设置「知识点」，学员再做过这些题（课后练习或考试）。"
      />
    </div>

    <!-- 学员学情 -->
    <div v-else-if="tab === 'students'" class="mc-card ana__panel">
      <template v-if="students && students.students.length > 0">
        <div class="mc-card__title-row">
          <span class="mc-card__title">按错题数排序（条长 = 错题数）</span>
          <span class="mc-muted ana__titlehint">共 {{ students.students.length }} 名学员有作答数据</span>
        </div>
        <BarList :items="studentBars" :limit="15" caption="学员错题数对比" />
        <div class="ana__tablewrap">
          <table class="mc-table">
            <thead>
              <tr>
                <th>学员</th>
                <th>作答</th>
                <th>正确率</th>
                <th>水平</th>
                <th>错题数</th>
                <th>涉及知识点</th>
                <th>最弱知识点</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in students.students" :key="s.user_id">
                <td>{{ s.display_name || s.username }}</td>
                <td>{{ s.graded }}</td>
                <td>{{ pct(s.accuracy) }}</td>
                <td>
                  <Tag :tone="MASTERY_TONE[s.level]" size="sm">
                    <Icon :name="MASTERY_ICON[s.level]" :size="13" />
                    {{ MASTERY_LABEL[s.level] }}
                  </Tag>
                </td>
                <td>{{ s.wrong }}</td>
                <td>{{ s.points }}</td>
                <td>
                  <span v-if="s.weakest_point">{{ s.weakest_point }}（错 {{ s.weakest_wrong }}）</span>
                  <span v-else class="mc-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="mc-hint">{{ students.dataNote }}</p>
      </template>
      <EmptyState
        v-else
        icon="users"
        title="还没有学员作答数据"
        description="学员做过课后练习或提交过考试后，这里会按错题数排出需要关注的人。"
      />
    </div>

    <!-- 高频错题 -->
    <div v-else-if="tab === 'wrong'" class="mc-card ana__panel">
      <div class="ana__filterline">
        <label class="ana__field">
          <span class="mc-label">最少作答</span>
          <select v-model.number="minAttempts" class="mc-select" aria-label="最少作答次数" @change="loadTab">
            <option :value="1">1 次（含噪声）</option>
            <option :value="2">2 次</option>
            <option :value="3">3 次</option>
            <option :value="5">5 次</option>
          </select>
        </label>
        <span class="mc-muted">排序用威尔逊置信下界：样本少的自动降权，避免"答 1 次错 1 次"霸榜</span>
      </div>
      <template v-if="wrong && wrong.questions.length > 0">
        <div class="mc-card__title-row">
          <span class="mc-card__title">错误率排行（条越长越该讲，颜色 = 严重程度）</span>
          <span class="mc-muted ana__titlehint"
            ><Icon name="flame" :size="14" /> 共 {{ wrong.questions.length }} 道</span
          >
        </div>
        <BarList :items="wrongBars" :limit="20" caption="高频错题错误率排行" />
        <p class="mc-hint">{{ wrong.dataNote }}</p>
      </template>
      <EmptyState
        v-else
        icon="alert"
        title="没有满足条件的错题"
        :description="wrong?.dataNote ?? '把「最少作答」调到 1 可以查看全部有作答的题目。'"
      />
    </div>

    <!-- 作答趋势 -->
    <div v-else class="mc-card ana__panel">
      <template v-if="overview && overview.trend.length > 0">
        <div class="mc-card__title-row">
          <span class="mc-card__title">作答趋势（柱 = 每天作答量，折线 = 正确率）</span>
          <span class="mc-muted ana__titlehint">鼠标移到柱子上看当天明细</span>
        </div>
        <TrendChart :data="overview.trend" :height="240" />
      </template>
      <EmptyState
        v-else
        icon="trendingUp"
        title="范围内没有作答记录"
        description="学员开始做题后，这里会显示每天的作答量与正确率趋势。"
      />
    </div>
  </section>
</template>

<style scoped>
.ana__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
}

.ana__stamp {
  font-size: var(--mc-text-xs);
}

.ana__note {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
}

.ana__note--warn {
  background: var(--mc-warning-soft);
  border-color: var(--mc-warning-border);
  color: var(--mc-warning-fg);
}

.ana__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--mc-space-3);
}

.ana__masteryrow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--mc-space-3);
}

.ana__masteryitem {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ana__masteryhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.ana__masterynum {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.ana__tabs {
  display: flex;
  gap: var(--mc-space-1);
  border-bottom: 1px solid var(--mc-border);
}

.ana__tab {
  padding: var(--mc-space-2) var(--mc-space-3);
  border: none;
  background: none;
  cursor: pointer;
  color: var(--mc-text-muted);
  font-size: var(--mc-text-sm);
  border-bottom: 2px solid transparent;
}

.ana__tab.is-active {
  color: var(--mc-primary-fg);
  border-bottom-color: var(--mc-primary);
  font-weight: var(--mc-font-medium);
}

.ana__panel {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.ana__tablewrap {
  overflow-x: auto;
}

.ana__row {
  cursor: pointer;
}

.ana__detail td {
  background: var(--mc-bg-sunken);
}

.ana__wronglist {
  margin: var(--mc-space-1) 0 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--mc-text-sm);
}

.ana__stem {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ana__filterline {
  display: flex;
  align-items: flex-end;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
}

.ana__chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 200px;
  padding: var(--mc-space-2) 0;
  overflow-x: auto;
}

.ana__bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  min-width: 18px;
  flex: 1;
}

.ana__barstack {
  width: 100%;
  max-width: 26px;
  background: var(--mc-danger-soft);
  border-radius: var(--mc-radius-xs) var(--mc-radius-xs) 0 0;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}

.ana__barcorrect {
  width: 100%;
  background: var(--mc-success);
}

.ana__barlabel {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  margin-top: 4px;
  white-space: nowrap;
}
</style>
