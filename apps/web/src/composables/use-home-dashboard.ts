/**
 * 首页数据看板的数据与派生指标。
 *
 * 只做「取数 + 算数」，不碰 DOM：
 *   - `/courses` 提供课程与当前用户的完成课时（在学 / 已学完 / 收藏）；
 *   - `/me/summary`、`/me/wrong-questions` 提供学习时长、等级与错题；
 *   - 界面上的每个数字都由这里派生，页面与区块组件只负责摆放。
 */
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import type { Category, Course } from '@/api/types';

interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

interface Summary {
  minutes: number;
  finishedLessons: number;
  quizzed: number;
  level: string;
  nextMinutes: number | null;
}

interface WrongBook {
  total: number;
  pending: number;
}

export type MetricTone = 'primary' | 'success' | 'info' | 'warning' | 'neutral';

export interface HomeMetric {
  label: string;
  value: number;
  unit: string;
  tone: MetricTone;
}

export function useHomeDashboard() {
  const { data } = useAsync<CoursesResponse>(() => api.get<CoursesResponse>('/courses'));
  const summary = ref<Summary | null>(null);
  const wrong = ref<WrongBook | null>(null);

  /** 两个次要指标独立容错：任一失败不拖垮整页 */
  async function load(): Promise<void> {
    const [s, w] = await Promise.all([
      api.get<Summary>('/me/summary').catch(() => null),
      api.get<WrongBook>('/me/wrong-questions').catch(() => null),
    ]);
    summary.value = s;
    wrong.value = w;
  }

  const courses = computed(() => data.value?.courses ?? []);

  function progressOf(course: Course): number {
    const total = course.total ?? 0;
    if (total === 0) return 0;
    return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
  }

  /** 只看"在学"课程的进度：全站总进度对个人没有行动意义 */
  const learning = computed(() =>
    courses.value.filter((c) => progressOf(c) > 0 && progressOf(c) < 100).sort((a, b) => progressOf(b) - progressOf(a)),
  );
  const learningTotal = computed(() => learning.value.reduce((s, c) => s + (c.total ?? 0), 0));
  const learningDone = computed(() => learning.value.reduce((s, c) => s + (c.finished ?? 0), 0));
  const learningPercent = computed(() =>
    learningTotal.value > 0 ? Math.round((learningDone.value / learningTotal.value) * 100) : 0,
  );

  const finishedCourses = computed(() => courses.value.filter((c) => (c.total ?? 0) > 0 && progressOf(c) >= 100));
  const favoriteCourses = computed(() => courses.value.filter((c) => c.fav));

  /** 看板头条指标：全部真实 */
  const metrics = computed<HomeMetric[]>(() => [
    { label: '学习时长', value: summary.value?.minutes ?? 0, unit: '分钟', tone: 'primary' },
    { label: '已完成课时', value: summary.value?.finishedLessons ?? 0, unit: '个', tone: 'success' },
    { label: '完成练习', value: summary.value?.quizzed ?? 0, unit: '次', tone: 'info' },
    {
      label: '错题待复习',
      value: wrong.value?.pending ?? 0,
      unit: '题',
      tone: (wrong.value?.pending ?? 0) > 0 ? 'warning' : 'neutral',
    },
  ]);

  /** 等级进度：距下一级还差多少分钟（后端已给 nextMinutes） */
  const levelHint = computed(() => {
    const s = summary.value;
    if (!s) return '正在读取学习数据…';
    if (s.nextMinutes === null) return '已是最高等级';
    return `再学 ${s.nextMinutes} 分钟升级`;
  });

  return {
    summary,
    wrong,
    learning,
    learningDone,
    learningTotal,
    learningPercent,
    finishedCourses,
    favoriteCourses,
    metrics,
    levelHint,
    progressOf,
    load,
  };
}
