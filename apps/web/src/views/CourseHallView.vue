<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { useAsync, errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import StatCard from '@/components/StatCard.vue';
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

const keyword = ref('');
const categoryId = ref<number | ''>('');
const onlyFav = ref(false);
const onlyUnfinished = ref(false);

const courses = computed(() => data.value?.courses ?? []);

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

async function toggleFav(course: Course): Promise<void> {
  try {
    const res = await api.post<{ fav: boolean }>(`/courses/${course.id}/fav`);
    course.fav = res.fav;
    toast.success(res.fav ? '已加入我的收藏' : '已取消收藏');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

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
      description="按章节组织的课程视频、配套知识点与课后练习；支持按分类、关键词与学习状态筛选。"
      icon="hall"
      :breadcrumb="[{ label: '首页' }, { label: '课程大厅' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="loading" @click="run()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
      </template>

      <template #meta>
        <StatCard label="课程总数" :value="courses.length" unit="门" icon="courses" tone="primary" />
        <StatCard
          label="已学完课时"
          :value="data?.orphans.finished ?? 0"
          unit="个"
          icon="check-circle"
          tone="success"
        />
        <StatCard label="已完成练习" :value="data?.orphans.quiz ?? 0" unit="次" icon="exam" tone="info" />
        <StatCard
          label="待归类课时"
          :value="data?.orphans.total ?? 0"
          unit="个"
          icon="alert"
          :tone="(data?.orphans.total ?? 0) > 0 ? 'warning' : 'neutral'"
          hint="未挂到任何课程"
        />
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
          <option v-for="c in data?.categories ?? []" :key="c.id" :value="c.id">{{ c.name }}</option>
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
        <span v-if="keyword || categoryId !== '' || onlyFav || onlyUnfinished" class="mc-muted hall__count">
          筛选出 {{ filtered.length }} / {{ courses.length }} 门
        </span>
        <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="resetFilters">
          <Icon name="reset" :size="15" />
          重置
        </button>
      </template>
    </Toolbar>

    <div v-if="loading && courses.length === 0" class="mc-grid mc-grid--cards">
      <div v-for="i in 8" :key="i" class="hall__skeleton">
        <div class="mc-skeleton hall__skeleton-cover" />
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

    <div v-else class="mc-grid mc-grid--cards">
      <article v-for="course in filtered" :key="course.id" class="course-card mc-card mc-card--interactive">
        <RouterLink
          class="course-card__cover"
          :to="{ name: 'course', params: { id: course.id } }"
          tabindex="-1"
          :aria-label="`进入课程 ${course.name}`"
        >
          <img v-if="course.cover" :src="`/api/v1/course-cover/${course.id}`" :alt="course.name" loading="lazy" />
          <span
            v-else
            class="course-card__cover-fallback"
            :class="`course-card__cover-fallback--g${Math.abs(course.id) % 6}`"
            aria-hidden="true"
          >
            <Icon name="graduation" :size="28" />
          </span>
          <span v-if="course.category_name" class="course-card__cover-chip">{{ course.category_name }}</span>
          <span v-if="course.published !== 1" class="course-card__draft">草稿</span>
          <span v-if="progressOf(course) >= 100" class="course-card__done">
            <Icon name="check" :size="13" />
            已学完
          </span>
        </RouterLink>

        <div class="course-card__body">
          <div class="course-card__head">
            <RouterLink class="course-card__name" :to="{ name: 'course', params: { id: course.id } }">
              {{ course.name }}
            </RouterLink>
            <button
              class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon course-card__fav"
              :class="{ 'course-card__fav--on': course.fav }"
              type="button"
              :aria-label="course.fav ? '取消收藏' : '收藏课程'"
              :title="course.fav ? '取消收藏' : '收藏课程'"
              @click="toggleFav(course)"
            >
              <Icon name="star" :size="16" :filled="course.fav" />
            </button>
          </div>

          <p v-if="course.description" class="course-card__desc mc-clamp-2">{{ course.description }}</p>

          <div class="course-card__meta">
            <span class="course-card__stat">
              <Icon name="video" :size="14" />
              {{ course.total ?? 0 }} 课时
            </span>
            <span class="course-card__stat">
              <Icon name="check-circle" :size="14" />
              已完成 {{ course.finished ?? 0 }}
            </span>
            <Tag v-if="(course.quiz ?? 0) > 0" tone="success" size="sm" icon="pen-line"> 已练习 {{ course.quiz }} </Tag>
          </div>

          <ProgressBar
            :value="progressOf(course)"
            :tone="progressOf(course) >= 100 ? 'success' : 'primary'"
            :label="`${course.finished ?? 0}/${course.total ?? 0}`"
          />

          <RouterLink
            class="mc-btn mc-btn--block course-card__cta"
            :class="progressOf(course) > 0 ? 'mc-btn--primary' : 'mc-btn--soft'"
            :to="{ name: 'course', params: { id: course.id } }"
          >
            <Icon :name="progressOf(course) > 0 ? 'play' : 'book-open'" :size="15" />
            {{ progressOf(course) > 0 ? '继续学习' : '开始学习' }}
          </RouterLink>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.hall {
  display: flex;
  flex-direction: column;
}

/* ---- 工具条里的搜索框：图标 + 输入框一体 ---- */
.hall__search {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-3);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-muted);
  transition:
    border-color var(--mc-duration) var(--mc-ease),
    box-shadow var(--mc-duration) var(--mc-ease);
}

.hall__search:focus-within {
  border-color: var(--mc-primary);
  box-shadow: var(--mc-focus-ring);
}

.hall__search-input {
  min-width: 200px;
  border: none !important;
  box-shadow: none !important;
  background: transparent;
}

.hall__select {
  width: auto;
  min-width: 140px;
}

.hall__count {
  font-size: var(--mc-text-xs);
}

/* ---- 加载骨架：与真实卡片同形 ---- */
.hall__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
}

.hall__skeleton-cover {
  height: 116px;
  border-radius: var(--mc-radius);
}

.hall__skeleton-line {
  height: 14px;
}

.hall__skeleton-line--short {
  width: 55%;
}

/* ---- 课程卡片 ---- */
.course-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.course-card__cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 6;
  overflow: hidden;
  /* 墨卷：封面用暖色平涂 + 一条细底边，不用渐变光晕 */
  background: color-mix(in srgb, var(--mc-primary) 7%, var(--mc-bg-sunken));
  border-bottom: 1px solid var(--mc-border);
}

.course-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--mc-duration) var(--mc-ease-out);
}

.course-card:hover .course-card__cover img {
  transform: scale(1.03);
}

/* 没有封面的课程：按 id 稳定分配一组配色，避免整屏都是同一块灰渐变 */
.course-card__cover-fallback {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--mc-radius-md);
  background: var(--mc-primary);
  border: 1px solid transparent;
  /* 图标压在实色块上：固定白色（--mc-text-inverse 会随主题翻成深色） */
  color: var(--mc-neutral-0);
}

@media (hover: hover) and (pointer: fine) {
  .course-card:hover .course-card__cover-fallback {
    transform: scale(1.06) rotate(-2deg);
  }
}

.course-card__cover-fallback--g0 {
  background: var(--mc-chart-1);
}

.course-card__cover-fallback--g1 {
  background: var(--mc-chart-2);
}

.course-card__cover-fallback--g2 {
  background: var(--mc-chart-3);
}

.course-card__cover-fallback--g3 {
  background: var(--mc-chart-4);
}

.course-card__cover-fallback--g4 {
  background: var(--mc-chart-5);
}

.course-card__cover-fallback--g5 {
  background: var(--mc-chart-6);
}

/* 封面左上角分类胶囊：让"这是什么课"第一眼就有信息 */
.course-card__cover-chip {
  position: absolute;
  left: var(--mc-space-2);
  bottom: var(--mc-space-2);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: color-mix(in srgb, var(--mc-bg-elevated) 86%, transparent);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  backdrop-filter: blur(6px);
  border: 1px solid var(--mc-border);
}

.course-card__draft,
.course-card__done {
  position: absolute;
  top: var(--mc-space-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--mc-radius-pill);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  backdrop-filter: blur(4px);
}

.course-card__draft {
  left: var(--mc-space-2);
  background: color-mix(in srgb, var(--mc-warning) 90%, transparent);
  color: var(--mc-text-inverse);
}

.course-card__done {
  right: var(--mc-space-2);
  background: color-mix(in srgb, var(--mc-success) 92%, transparent);
  color: var(--mc-text-inverse);
}

.course-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-card-pad);
  flex: 1;
}

.course-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-2);
}

/* 课程名本身就是入口链接，给足点击高度（整卡不可点时它就是唯一目标） */
.course-card__name {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 0;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  line-height: var(--mc-leading-tight);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.course-card__fav {
  color: var(--mc-text-muted);
  margin: -4px -8px 0 0;
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

.course-card__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-muted);
}

/* 简介缺失时卡片会矮一截：把 meta 行往下推，保证一排卡片底部对齐 */
.course-card__head {
  margin-bottom: auto;
}

.course-card__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.course-card__stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.course-card__cta {
  margin-top: auto;
}
</style>
