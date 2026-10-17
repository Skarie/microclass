<script setup lang="ts">
/**
 * 课程大厅：纯浏览页
 *
 * 去掉了与首页/工具条重复的东西：
 *  - 主视觉（品牌主张 + 大搜索 + 「浏览全部课程」+ 刷新）→ 首页承担品牌与看板，这里不需要第二遍
 *  - 实力数据带（课程/课时/分类/已学完/在学）→ 首页数据看板已有
 *  - 分类金刚区 → 与工具条的"分类"下拉筛选完全重复
 *  - 继续学习主推块 → 首页「最近在学」与「我的课程」已覆盖
 * 只保留：标题描述 → 搜索/筛选/呈现切换 → 课程（卡片或列表，按分类分组）
 */
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { useAsync, errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import Tag from '@/components/Tag.vue';
import Toolbar from '@/components/Toolbar.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import type { Category, Course } from '@/api/types';

interface CoursesResponse {
  courses: Course[];
  categories: Category[];
  orphans: { total: number; finished: number; quiz: number };
}

const toast = useToastStore();
const { data, loading, run } = useAsync<CoursesResponse>(() => api.get<CoursesResponse>('/courses'));

/* 呈现方式：卡片（对标中国大学 MOOC）或列表（一屏看更多） */
const VIEW_KEY = 'mc.hall.view';
const viewMode = ref<'cards' | 'list'>(readViewMode());
function readViewMode(): 'cards' | 'list' {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}
function setViewMode(next: 'cards' | 'list'): void {
  viewMode.value = next;
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* 隐私模式下忽略 */
  }
}

const keyword = ref('');
const categoryId = ref<number | ''>('');
const onlyFav = ref(false);
const onlyUnfinished = ref(false);

const courses = computed(() => data.value?.courses ?? []);
const categories = computed(() => data.value?.categories ?? []);

const filtered = computed(() =>
  courses.value.filter((c) => {
    if (keyword.value && !`${c.name} ${c.description}`.toLowerCase().includes(keyword.value.toLowerCase()))
      return false;
    if (categoryId.value !== '' && c.category_id !== categoryId.value) return false;
    if (onlyFav.value && !c.fav) return false;
    if (onlyUnfinished.value && (c.total ?? 0) > 0 && (c.finished ?? 0) >= (c.total ?? 0)) return false;
    return true;
  }),
);

function progressOf(course: Course): number {
  const total = course.total ?? 0;
  if (total === 0) return 0;
  return Math.min(100, Math.round(((course.finished ?? 0) / total) * 100));
}

/** 按分类分组（无分类归入"未分类"） */
const groups = computed(() => {
  const map = new Map<string, Course[]>();
  for (const c of filtered.value) {
    const key = c.category_name || '未分类';
    const arr = map.get(key);
    if (arr) arr.push(c);
    else map.set(key, [c]);
  }
  return [...map.entries()].map(([name, list]) => ({ name, list }));
});

async function toggleFav(course: Course): Promise<void> {
  try {
    const res = await api.post<{ fav: boolean }>(`/courses/${course.id}/fav`);
    course.fav = res.fav;
    toast.success(res.fav ? '已加入我的收藏' : '已取消收藏');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

const hasFilter = computed(
  () => Boolean(keyword.value) || categoryId.value !== '' || onlyFav.value || onlyUnfinished.value,
);

function resetFilters(): void {
  keyword.value = '';
  categoryId.value = '';
  onlyFav.value = false;
  onlyUnfinished.value = false;
}
</script>

<template>
  <section class="hall">
    <PageHeader
      title="课程大厅"
      description="按分类浏览全部课程；点课程进入章节与课时，继续上次的进度。"
      icon="hall"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '课程大厅' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="run()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
      </template>
    </PageHeader>

    <Toolbar>
      <template #left>
        <label class="hall__search">
          <Icon name="search" :size="15" />
          <input
            v-model.trim="keyword"
            class="mc-input mc-input--search hall__search-input"
            type="search"
            placeholder="搜索课程名称或简介"
            aria-label="搜索课程"
          />
        </label>
        <select v-model="categoryId" class="mc-select hall__select" aria-label="按分类筛选">
          <option value="">全部分类</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <label class="mc-checkbox">
          <input v-model="onlyFav" type="checkbox" />
          只看收藏
        </label>
        <label class="mc-checkbox">
          <input v-model="onlyUnfinished" type="checkbox" />
          只看未学完
        </label>
      </template>
      <template #right>
        <span class="mc-muted hall__count mc-num">
          {{ hasFilter ? `筛选出 ${filtered.length} / ${courses.length}` : `共 ${courses.length}` }} 门
        </span>
        <div class="hall__views" role="group" aria-label="呈现方式">
          <button
            class="mc-btn mc-btn--sm mc-btn--icon"
            :class="viewMode === 'cards' ? 'mc-btn--soft' : 'mc-btn--ghost'"
            type="button"
            :aria-pressed="viewMode === 'cards'"
            aria-label="卡片展示"
            title="卡片展示"
            @click="setViewMode('cards')"
          >
            <Icon name="grid" :size="15" />
          </button>
          <button
            class="mc-btn mc-btn--sm mc-btn--icon"
            :class="viewMode === 'list' ? 'mc-btn--soft' : 'mc-btn--ghost'"
            type="button"
            :aria-pressed="viewMode === 'list'"
            aria-label="列表展示"
            title="列表展示"
            @click="setViewMode('list')"
          >
            <Icon name="list" :size="15" />
          </button>
        </div>
        <button v-if="hasFilter" class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="resetFilters">
          <Icon name="reset" :size="15" />
          重置
        </button>
      </template>
    </Toolbar>

    <div v-if="loading && courses.length === 0" class="hall__list" aria-hidden="true">
      <div v-for="i in 6" :key="i" class="hall__row-skeleton">
        <div class="mc-skeleton hall__skeleton-thumb" />
        <div class="mc-skeleton hall__skeleton-line" />
        <div class="mc-skeleton hall__skeleton-line hall__skeleton-line--short" />
      </div>
    </div>

    <EmptyState
      v-else-if="filtered.length === 0"
      icon="search"
      title="没有匹配的课程"
      description="换个关键词或清空筛选条件试试。若还没有课程，请联系管理员在「课程管理」中创建。"
      action-text="重置筛选"
      @action="resetFilters"
    />

    <section v-for="group in groups" v-else :key="group.name" class="hall__group">
      <header class="hall__group-head">
        <h2 class="hall__group-title">{{ group.name }}</h2>
        <span class="hall__group-count mc-num">{{ group.list.length }}</span>
      </header>

      <!-- 卡片网格 -->
      <div v-if="viewMode === 'cards'" class="hall__cards">
        <article
          v-for="course in group.list"
          :key="course.id"
          class="course-card course-card--tile mc-card mc-card--interactive"
          :class="`course-card--g${Math.abs(course.id) % 6}`"
        >
          <RouterLink
            class="course-card__cover"
            :to="{ name: 'course', params: { id: course.id } }"
            tabindex="-1"
            :aria-label="`进入课程 ${course.name}`"
          >
            <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
            <span v-else class="course-card__cover-fallback" aria-hidden="true">
              <Icon name="graduation" :size="30" />
            </span>
            <span v-if="course.category_name" class="course-card__cover-chip">{{ course.category_name }}</span>
            <span v-if="progressOf(course) >= 100" class="course-card__cover-done">
              <Icon name="check" :size="13" />
              已学完
            </span>
          </RouterLink>

          <div class="course-card__tile-body">
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
              <Tag v-if="course.published !== 1" tone="warning" size="sm">草稿</Tag>
            </div>
            <ProgressBar
              :value="progressOf(course)"
              :tone="progressOf(course) >= 100 ? 'success' : 'primary'"
              :label="`${course.finished ?? 0}/${course.total ?? 0}`"
            />
            <div class="course-card__tile-actions">
              <RouterLink
                class="mc-btn mc-btn--sm"
                :class="progressOf(course) > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
                :to="{ name: 'course', params: { id: course.id } }"
              >
                {{ progressOf(course) > 0 ? '继续学习' : '开始学习' }}
              </RouterLink>
              <button
                class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
                :class="{ 'course-card__fav--on': course.fav }"
                type="button"
                :aria-label="course.fav ? '取消收藏' : '收藏课程'"
                :title="course.fav ? '取消收藏' : '收藏课程'"
                @click="toggleFav(course)"
              >
                <Icon name="star" :size="16" :filled="course.fav" />
              </button>
            </div>
          </div>
        </article>
      </div>

      <!-- 紧凑列表 -->
      <ul v-else class="hall__list">
        <li
          v-for="course in group.list"
          :key="course.id"
          class="course-card course-card--row"
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
              <Tag v-if="course.published !== 1" tone="warning" size="sm">草稿</Tag>
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
            <button
              class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
              :class="{ 'course-card__fav--on': course.fav }"
              type="button"
              :aria-label="course.fav ? '取消收藏' : '收藏课程'"
              :title="course.fav ? '取消收藏' : '收藏课程'"
              @click="toggleFav(course)"
            >
              <Icon name="star" :size="16" :filled="course.fav" />
            </button>
            <RouterLink
              class="mc-btn mc-btn--sm"
              :class="progressOf(course) > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
              :to="{ name: 'course', params: { id: course.id } }"
            >
              {{ progressOf(course) > 0 ? '继续学习' : '开始学习' }}
            </RouterLink>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.hall {
  display: flex;
  flex-direction: column;
}

.hall__search {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-3);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-muted);
  transition: var(--mc-transition-all);
}

.hall__search:focus-within {
  border-color: var(--mc-primary);
  box-shadow: var(--mc-focus-ring);
}

/* 用后代选择器压过 .mc-input 的边框，避免 !important */
.hall__search .hall__search-input {
  min-width: 200px;
  border: none;
  box-shadow: none;
  background: transparent;
}

.hall__select {
  width: auto;
  min-width: 140px;
}

.hall__count {
  font-size: var(--mc-text-xs);
}

.hall__views {
  display: flex;
  gap: var(--mc-space-1);
}

/* 分组 */
.hall__group + .hall__group {
  margin-top: var(--mc-space-6);
}

.hall__group-head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-3);
}

.hall__group-title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text-secondary);
  letter-spacing: 0.02em;
}

.hall__group-count {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* 卡片网格 */
.hall__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: var(--mc-space-3);
}

.course-card--tile {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.course-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background-image: var(--mc-gradient-brand-soft);
  color: var(--mc-primary-fg);
}

.course-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card--g1 .course-card__cover {
  color: var(--mc-accent-fg);
}
.course-card--g2 .course-card__cover {
  color: var(--mc-success-fg);
}
.course-card--g3 .course-card__cover {
  color: var(--mc-warning-fg);
}
.course-card--g5 .course-card__cover {
  color: var(--mc-seal-fg);
}

.course-card__cover-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
}

.course-card__cover-chip {
  position: absolute;
  top: var(--mc-space-2);
  left: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-elevated);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
}

.course-card__cover-done {
  position: absolute;
  right: var(--mc-space-2);
  bottom: var(--mc-space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-success-soft);
  font-size: var(--mc-text-xs);
  color: var(--mc-success-fg);
}

.course-card__tile-body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  padding: var(--mc-space-3);
  min-width: 0;
}

.course-card__tile-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-top: var(--mc-space-1);
}

/* 紧凑列表 */
.hall__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.course-card--row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 180px auto;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  transition: var(--mc-transition-colors);
}

@media (hover: hover) and (pointer: fine) {
  .course-card--row:hover {
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

.course-card--tile .course-card__name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  min-height: calc(var(--mc-text-base) * 1.5 * 2);
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

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

/* 骨架 */
.hall__row-skeleton {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) 180px;
  align-items: center;
  gap: var(--mc-space-4);
  padding: var(--mc-space-3);
}

.hall__skeleton-thumb {
  height: 44px;
  border-radius: var(--mc-radius-sm);
}

.hall__skeleton-line {
  height: 14px;
}

.hall__skeleton-line--short {
  width: 45%;
}

@media (max-width: 900px) {
  .course-card--row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
