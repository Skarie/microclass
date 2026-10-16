<script setup lang="ts">
/**
 * 我的课程（对标中国大学 MOOC 的一级导航「我的课程」）
 *
 * MOOC 把「上课」放在最外层导航：在学 / 已学完 / 收藏三组聚合，
 * 让学习者不必每次回大厅里找自己那几门课。本项目此前只有大厅的"继续学习"主推块，缺这一层。
 *
 * 数据源：`/courses`（含每门课的课时数与已完成数、收藏标记）。全部真实数据。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { useAsync } from '@/composables/useAsync';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import type { Category, Course } from '@/api/types';

interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

const { data, loading } = useAsync<CoursesResponse>(() => api.get<CoursesResponse>('/courses'));
const courses = computed(() => data.value?.courses ?? []);

function progressOf(course: Course): number {
  const total = course.total ?? 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
}

/** 在学：有进度且未学完；按进度倒序（最快能学完的排前面） */
const learning = computed(() =>
  courses.value.filter((c) => progressOf(c) > 0 && progressOf(c) < 100).sort((a, b) => progressOf(b) - progressOf(a)),
);
/** 已学完：全部课时完成 */
const finished = computed(() => courses.value.filter((c) => (c.total ?? 0) > 0 && progressOf(c) >= 100));
/** 收藏：学生自己标记过的 */
const favorites = computed(() => courses.value.filter((c) => c.fav));

const groups = computed(() => [
  { key: 'learning', title: '在学', hint: '继续上次的进度', list: learning.value },
  { key: 'favorites', title: '收藏', hint: '想学但还没开始的', list: favorites.value },
  { key: 'finished', title: '已学完', hint: '可以复习或去刷题', list: finished.value },
]);

const isEmpty = computed(() => learning.value.length + finished.value.length + favorites.value.length === 0);
</script>

<template>
  <section class="my">
    <PageHeader
      title="我的课程"
      description="在学、收藏与已学完的课程都在这里；点一门课继续上次的进度。"
      icon="courses"
      :breadcrumb="[{ label: '首页' }, { label: '我的课程' }]"
    />

    <div v-if="loading && courses.length === 0" class="my__skeleton">
      <div v-for="i in 4" :key="i" class="mc-skeleton my__skeleton-row" />
    </div>

    <EmptyState
      v-else-if="isEmpty"
      icon="courses"
      title="还没有在学的课程"
      description="去课程大厅挑一门开始吧；学过、收藏、学完的课程会自动出现在这里。"
      action-text="去课程大厅"
      @action="$router.push({ name: 'hall' })"
    />

    <template v-else>
      <section v-for="group in groups" v-show="group.list.length > 0" :key="group.key" class="my__group">
        <header class="my__group-head">
          <h2 class="my__group-title">{{ group.title }}</h2>
          <span class="my__group-hint mc-muted">{{ group.hint }}</span>
          <span class="my__group-count mc-num">{{ group.list.length }}</span>
        </header>

        <ul class="my__list">
          <li
            v-for="course in group.list"
            :key="course.id"
            class="my__row course-card course-card--row"
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
                <span class="course-card__stat">
                  <Icon name="video" :size="13" />
                  {{ course.total ?? 0 }} 课时
                </span>
                <span class="course-card__stat">
                  <Icon name="check-circle" :size="13" />
                  已完成 {{ course.finished ?? 0 }}
                </span>
                <Tag v-if="(course.quiz ?? 0) > 0" tone="success" size="sm" icon="pen-line">
                  已练习 {{ course.quiz }}
                </Tag>
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

            <div class="course-card__row-actions">
              <RouterLink
                class="mc-btn mc-btn--sm"
                :class="progressOf(course) > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
                :to="{ name: 'course', params: { id: course.id } }"
              >
                {{ progressOf(course) >= 100 ? '复习' : progressOf(course) > 0 ? '继续学习' : '开始学习' }}
              </RouterLink>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.my {
  display: flex;
  flex-direction: column;
}

.my__group + .my__group {
  margin-top: var(--mc-space-8);
}

.my__group-head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
}

.my__group-title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text-secondary);
  letter-spacing: 0.02em;
}

.my__group-hint {
  font-size: var(--mc-text-xs);
}

.my__group-count {
  margin-left: auto;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.my__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.my__row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 180px auto;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  transition: var(--mc-transition-colors);
}

@media (hover: hover) and (pointer: fine) {
  .my__row:hover {
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
.course-card--g3 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-4);
  color: var(--mc-warning-fg);
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

.course-card__row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
}

.my__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.my__skeleton-row {
  height: 56px;
}

@media (max-width: 900px) {
  .my__row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
