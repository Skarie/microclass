<script setup lang="ts">
/**
 * 首页 · 数据看板（课程已迁到独立的「课程大厅」页）
 *
 * 结构：
 *   ① 问候 + 一句话现状（今天/总体一句能读懂的话）
 *   ② 我的学习看板：学习时长、已完成课时、完成练习、错题待复习、等级进度
 *   ③ 学习资产：在学 / 已学完 / 收藏 + 总课时完成率（真实数据）
 *   ④ 最近在学：前 3 门，直接继续
 *   ⑤ 快捷跳转：学习入口 + 教学管理入口（管理员）
 *
 * 所有数字都来自真实接口：/me/summary、/me/wrong-questions、/courses。
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import { useAuthStore } from '@/stores/auth';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import type { Category, Course } from '@/api/types';
import type { IconName } from '@/components/icons';

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

const auth = useAuthStore();
const { data } = useAsync<CoursesResponse>(() => api.get<CoursesResponse>('/courses'));
const summary = ref<Summary | null>(null);
const wrong = ref<WrongBook | null>(null);

onMounted(async () => {
  const [s, w] = await Promise.all([
    api.get<Summary>('/me/summary').catch(() => null),
    api.get<WrongBook>('/me/wrong-questions').catch(() => null),
  ]);
  summary.value = s;
  wrong.value = w;
});

const courses = computed(() => data.value?.courses ?? []);

function progressOf(course: Course): number {
  const total = course.total ?? 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
}

const lessonTotal = computed(() => courses.value.reduce((s, c) => s + (c.total ?? 0), 0));
const finishedTotal = computed(() => courses.value.reduce((s, c) => s + (c.finished ?? 0), 0));
const overallPercent = computed(() =>
  lessonTotal.value > 0 ? Math.round((finishedTotal.value / lessonTotal.value) * 100) : 0,
);

const learning = computed(() =>
  courses.value.filter((c) => progressOf(c) > 0 && progressOf(c) < 100).sort((a, b) => progressOf(b) - progressOf(a)),
);
const finishedCourses = computed(() => courses.value.filter((c) => (c.total ?? 0) > 0 && progressOf(c) >= 100));
const favoriteCourses = computed(() => courses.value.filter((c) => c.fav));

/** 看板头条指标：全部真实 */
const metrics = computed(() => [
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

/** 快捷跳转：学习入口（所有人）+ 教学管理入口（管理员） */
interface Jump {
  to: string;
  label: string;
  icon: IconName;
  hint: string;
}
const learnJumps: Jump[] = [
  { to: '/hall', label: '课程大厅', icon: 'hall', hint: '浏览全部课程' },
  { to: '/my-courses', label: '我的课程', icon: 'courses', hint: '在学 · 收藏 · 已学完' },
  { to: '/wrong-book', label: '错题本', icon: 'wrong', hint: '复习错题' },
  { to: '/me', label: '个人中心', icon: 'user', hint: '学习记录与设置' },
];
const manageJumps: Jump[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid', hint: '平台待办与体检' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses', hint: '课程 · 章节 · 课时' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank', hint: '题库与题目' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam', hint: '组卷与成绩' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats', hint: '课时观看情况' },
  { to: '/admin/analytics', label: '学情分析', icon: 'chartPie', hint: '正确率与覆盖' },
  { to: '/admin/users', label: '学员与账号', icon: 'users', hint: '成员与权限' },
  { to: '/admin/settings', label: '系统设置', icon: 'settings', hint: '存储与安全' },
];
</script>

<template>
  <section class="home">
    <!-- ① 问候 -->
    <header class="home__greet">
      <div>
        <p class="home__eyebrow">
          <Icon name="sparkles" :size="15" />
          微课堂 · 数据看板
        </p>
        <h1 class="home__title">你好，{{ auth.user?.display_name || auth.user?.username || '同学' }}</h1>
        <p class="home__sub">
          <template v-if="learning.length > 0">
            有 <strong class="mc-num">{{ learning.length }}</strong> 门课正在进行，最近在学
            <strong>{{ learning[0]?.name }}</strong
            >（已完成 {{ learning[0]?.finished ?? 0 }}/{{ learning[0]?.total ?? 0 }} 课时）。
          </template>
          <template v-else> 还没有在学课程 —— 去课程大厅挑一门开始吧。 </template>
        </p>
      </div>
      <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'hall' }">
        <Icon name="hall" :size="15" />
        去课程大厅
      </RouterLink>
    </header>

    <!-- ② 我的学习看板 -->
    <section class="board" aria-label="我的学习数据">
      <div class="board__metrics">
        <div v-for="m in metrics" :key="m.label" class="board__metric" :class="`board__metric--${m.tone}`">
          <span class="board__label">{{ m.label }}</span>
          <span class="board__value mc-num">
            {{ m.value }}<span class="board__unit">{{ m.unit }}</span>
          </span>
        </div>
      </div>

      <div class="board__level">
        <div class="board__level-head">
          <span class="board__level-name">
            <Icon name="award" :size="15" />
            {{ summary?.level ?? '—' }}
          </span>
          <span class="mc-muted board__level-hint">{{ levelHint }}</span>
        </div>
        <p class="board__overall mc-muted">
          全部课程总进度 <strong class="mc-num">{{ finishedTotal }}/{{ lessonTotal }}</strong> 课时
        </p>
        <ProgressBar :value="overallPercent" tone="primary" :label="`${overallPercent}%`" />
      </div>
    </section>

    <!-- ③ 学习资产 -->
    <section class="assets" aria-label="学习资产">
      <article class="assets__item">
        <span class="assets__num mc-num">{{ learning.length }}</span>
        <span class="assets__label">在学课程</span>
      </article>
      <article class="assets__item">
        <span class="assets__num mc-num">{{ finishedCourses.length }}</span>
        <span class="assets__label">已学完课程</span>
      </article>
      <article class="assets__item">
        <span class="assets__num mc-num">{{ favoriteCourses.length }}</span>
        <span class="assets__label">收藏课程</span>
      </article>
      <article class="assets__item">
        <span class="assets__num mc-num">{{ wrong?.total ?? 0 }}</span>
        <span class="assets__label">错题收录</span>
      </article>
    </section>

    <!-- ④ 最近在学 -->
    <section v-if="learning.length > 0" class="recent">
      <header class="recent__head">
        <h2 class="recent__title">最近在学</h2>
        <RouterLink class="mc-link recent__more" :to="{ name: 'my-courses' }">我的课程 →</RouterLink>
      </header>
      <ul class="recent__list">
        <li
          v-for="course in learning.slice(0, 3)"
          :key="course.id"
          class="recent__row course-card course-card--row"
          :class="`course-card--g${Math.abs(course.id) % 6}`"
        >
          <RouterLink
            class="course-card__thumb"
            :to="{ name: 'course', params: { id: course.id } }"
            tabindex="-1"
            :aria-label="`进入课程 ${course.name}`"
          >
            <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
            <Icon v-else name="graduation" :size="20" />
          </RouterLink>
          <div class="course-card__row-main">
            <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
              {{ course.name }}
            </RouterLink>
            <div class="course-card__meta">
              <span class="course-card__stat"><Icon name="video" :size="13" />{{ course.total ?? 0 }} 课时</span>
              <span class="course-card__stat">
                <Icon name="check-circle" :size="13" />已完成 {{ course.finished ?? 0 }}
              </span>
              <Tag v-if="course.category_name" tone="primary" size="sm">{{ course.category_name }}</Tag>
            </div>
          </div>
          <div class="course-card__row-progress">
            <ProgressBar
              :value="progressOf(course)"
              :tone="progressOf(course) >= 100 ? 'success' : 'primary'"
              :label="`${course.finished ?? 0}/${course.total ?? 0}`"
            />
          </div>
          <RouterLink class="mc-btn mc-btn--sm mc-btn--soft" :to="{ name: 'course', params: { id: course.id } }">
            继续学习
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- ⑤ 快捷跳转 -->
    <section class="jumps" aria-label="快捷跳转">
      <header class="jumps__head">
        <h2 class="jumps__title">快捷跳转</h2>
        <span class="jumps__hint mc-muted">常用功能一站直达</span>
      </header>
      <nav class="jumps__grid">
        <RouterLink v-for="j in learnJumps" :key="j.to" class="jumps__item" :to="j.to">
          <span class="jumps__icon"><Icon :name="j.icon" :size="18" /></span>
          <span class="jumps__text">
            <span class="jumps__label">{{ j.label }}</span>
            <span class="jumps__hint2">{{ j.hint }}</span>
          </span>
        </RouterLink>
      </nav>

      <template v-if="auth.isAdmin">
        <header class="jumps__head jumps__head--sub">
          <h2 class="jumps__title">教学管理</h2>
          <span class="jumps__hint mc-muted">管理员可见</span>
        </header>
        <nav class="jumps__grid">
          <RouterLink v-for="j in manageJumps" :key="j.to" class="jumps__item" :to="j.to">
            <span class="jumps__icon jumps__icon--manage"><Icon :name="j.icon" :size="18" /></span>
            <span class="jumps__text">
              <span class="jumps__label">{{ j.label }}</span>
              <span class="jumps__hint2">{{ j.hint }}</span>
            </span>
          </RouterLink>
        </nav>
      </template>
    </section>
  </section>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-6);
}

/* ① 问候 */
.home__greet {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-4);
}

.home__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0 0 var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  letter-spacing: 0.06em;
  color: var(--mc-primary-fg);
}

.home__title {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.home__sub {
  margin: var(--mc-space-1) 0 0;
  max-width: 68ch;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

/* ② 看板 */
.board {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--mc-space-6);
  padding: var(--mc-space-6);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
}

.board__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--mc-space-4);
}

.board__metric {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding-left: var(--mc-space-4);
  border-left: 1px solid var(--mc-border);
}

.board__metric:first-child {
  padding-left: 0;
  border-left: 0;
}

.board__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.board__value {
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  color: var(--mc-text);
}

.board__unit {
  margin-left: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-normal);
  color: var(--mc-text-muted);
}

.board__metric--primary .board__value {
  color: var(--mc-primary-fg);
}
.board__metric--success .board__value {
  color: var(--mc-success-fg);
}
.board__metric--info .board__value {
  color: var(--mc-info-fg);
}
.board__metric--warning .board__value {
  color: var(--mc-warning-fg);
}

.board__level {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-6);
  border-left: 1px solid var(--mc-border);
}

.board__level-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

.board__level-name {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.board__level-hint {
  font-size: var(--mc-text-xs);
}

.board__overall {
  margin: 0;
  font-size: var(--mc-text-xs);
}

/* ③ 学习资产 */
.assets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--mc-space-4);
}

.assets__item {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
}

.assets__num {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  color: var(--mc-text);
}

.assets__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* ④ 最近在学 */
.recent__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
}

.recent__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text-secondary);
}

.recent__more {
  font-size: var(--mc-text-xs);
}

.recent__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent__row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 160px auto;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  transition: var(--mc-transition-colors);
}

@media (hover: hover) and (pointer: fine) {
  .recent__row:hover {
    background: var(--mc-bg-hover);
  }
}

.course-card__thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 44px;
  border-radius: var(--mc-radius-sm);
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
  color: var(--mc-primary-fg);
  flex: none;
}

.course-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card--g1 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-2);
  color: var(--mc-accent-fg);
}
.course-card--g2 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-3);
  color: var(--mc-success-fg);
}
.course-card--g5 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-6);
  color: var(--mc-seal-fg);
}

.course-card__row-main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.course-card__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-card__name:hover {
  color: var(--mc-primary-fg);
}

.course-card__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.course-card__stat {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
}

/* ⑤ 快捷跳转 */
.jumps__head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
}

.jumps__head--sub {
  margin-top: var(--mc-space-6);
}

.jumps__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text-secondary);
}

.jumps__hint {
  font-size: var(--mc-text-xs);
}

.jumps__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--mc-space-3);
}

.jumps__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .jumps__item:hover {
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-sm);
  }
}

.jumps__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mc-radius-md);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  flex: none;
}

.jumps__icon--manage {
  background: var(--mc-accent-soft);
  color: var(--mc-accent-fg);
}

.jumps__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.jumps__label {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text);
}

.jumps__hint2 {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .board {
    grid-template-columns: 1fr;
  }

  .board__level {
    padding-left: 0;
    border-left: 0;
    padding-top: var(--mc-space-4);
    border-top: 1px solid var(--mc-border);
  }

  .recent__row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
