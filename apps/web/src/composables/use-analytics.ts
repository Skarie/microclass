import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type {
  AnalyticsFilters,
  AnalyticsOverview,
  AnalyticsTab,
  CourseOption,
  PointsResponse,
  StudentsResponse,
  WrongResponse,
} from '@/views/admin/analytics/analytics-types';

/**
 * 学情分析的数据与请求：范围筛选、四个页签的按需加载、导出、地址栏回写。
 * 展示层派生（KPI 迷你图 / 掌握度 / 三个条形榜）在 use-analytics-charts。
 */
export function useAnalytics() {
  const toast = useToastStore();
  const route = useRoute();
  const router = useRouter();

  const tab = ref<AnalyticsTab>('points');
  const loading = ref(false);
  const courses = ref<CourseOption[]>([]);
  const filters = ref<AnalyticsFilters>({ courseId: '', days: 90 });
  const minAttempts = ref(2);

  const overview = ref<AnalyticsOverview | null>(null);
  const points = ref<PointsResponse | null>(null);
  const students = ref<StudentsResponse | null>(null);
  const wrong = ref<WrongResponse | null>(null);

  /** 公共筛选条件：课程 / 天数都按「有值才带」拼参，与拆分前一致 */
  const scopeQuery = computed(() => ({
    ...(filters.value.courseId === '' ? {} : { courseId: filters.value.courseId }),
    ...(filters.value.days > 0 ? { days: filters.value.days } : {}),
  }));

  async function loadCourses(): Promise<void> {
    try {
      const res = await api.get<{ courses: CourseOption[] }>('/courses', { limit: 200 });
      courses.value = (res.courses ?? []).map((c) => ({ id: c.id, name: c.name }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function loadOverview(): Promise<void> {
    overview.value = await api.get<AnalyticsOverview>('/analytics/overview', {
      ...scopeQuery.value,
      trendDays: 30,
    });
  }

  /** 只加载当前页签的数据（趋势页签直接用 overview.trend，无需请求） */
  async function loadTab(): Promise<void> {
    if (tab.value === 'points') {
      points.value = await api.get<PointsResponse>('/analytics/points', {
        ...scopeQuery.value,
        limit: 50,
        questionsPerPoint: 3,
      });
    } else if (tab.value === 'students') {
      students.value = await api.get<StudentsResponse>('/analytics/students', {
        ...scopeQuery.value,
        limit: 50,
      });
    } else if (tab.value === 'wrong') {
      wrong.value = await api.get<WrongResponse>('/analytics/wrong-questions', {
        ...scopeQuery.value,
        limit: 50,
        minAttempts: minAttempts.value,
      });
    }
  }

  async function loadAll(): Promise<void> {
    syncQuery();
    loading.value = true;
    try {
      // overview 与当前页签的数据互不依赖，并行请求；概览先到就先渲染，不让列表拖住首屏
      const overviewTask = loadOverview();
      const tabTask = loadTab();
      await overviewTask;
      loading.value = false;
      await tabTask;
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      loading.value = false;
    }
  }

  function switchTab(next: AnalyticsTab): void {
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

  /** 切换筛选时把条件写回地址栏，便于分享与刷新后保持 */
  function syncQuery(): void {
    void router.replace({
      query: {
        ...(filters.value.courseId === '' ? {} : { courseId: String(filters.value.courseId) }),
        ...(filters.value.days > 0 ? { days: String(filters.value.days) } : {}),
      },
    });
  }

  /** 首屏：支持深链 /admin/analytics?courseId=7&days=30（课程管理页可直接跳过来） */
  async function init(): Promise<void> {
    const qCourse = Number.parseInt(String(route.query.courseId ?? ''), 10);
    if (!Number.isNaN(qCourse)) filters.value.courseId = qCourse;
    const qDays = Number.parseInt(String(route.query.days ?? ''), 10);
    if (!Number.isNaN(qDays) && [7, 30, 90, 0].includes(qDays)) filters.value.days = qDays;

    // 课程下拉与统计互不依赖：并行拉取，避免串行等待
    loading.value = true;
    try {
      await Promise.all([loadCourses(), loadAll()]);
    } finally {
      loading.value = false;
    }
  }

  return reactive({
    tab,
    loading,
    courses,
    filters,
    minAttempts,
    overview,
    points,
    students,
    wrong,
    scopeQuery,
    loadCourses,
    loadOverview,
    loadTab,
    loadAll,
    switchTab,
    exportFile,
    syncQuery,
    init,
  });
}

export type AnalyticsState = ReturnType<typeof useAnalytics>;
