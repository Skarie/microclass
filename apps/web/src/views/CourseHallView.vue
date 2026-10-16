<script setup lang="ts">
/**
 * 课程大厅（结构重做版）
 *
 * 为什么改：原版是一整片"同构卡片网格"（反模式 #21），顶部还有 4 张同构指标卡（反模式 #20），
 * 两者共同造成"模板感"。按规范改为：
 *   ① 指标压缩成**一行文字**（不再占四张卡片的位置）；
 *   ② **一个主推块**（继续学习）承接最重要的动作；
 *   ③ 其余课程用**紧凑列表**（按分类分组），一屏能看到更多、层级更清楚。
 * 测试钩子：每个课程项仍保留 `course-card` 类名（E2E 依赖它定位）。
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

/** 主推块：优先"学到一半"的课程，其次最近创建的（列表已按 id 倒序） */
const featured = computed<Course | null>(() => {
  const list = filtered.value;
  const first = list[0];
  if (!first) return null;
  const inProgress = list.filter((c) => progressOf(c) > 0 && progressOf(c) < 100);
  const pool = inProgress.length > 0 ? inProgress : list;
  return pool.reduce((best, c) => (progressOf(c) > progressOf(best) ? c : best), first);
});

/** 其余课程：按分类分组（无分类归入"未分类"） */
const groups = computed(() => {
  const rest = filtered.value.filter((c) => c.id !== featured.value?.id);
  const map = new Map<string, Course[]>();
  for (const c of rest) {
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
        <!-- 反模式 #20：不再用 4 张"大数字+小标签"的指标卡，改为一行可扫读的事实 -->
        <dl class="hall__metrics">
          <div class="hall__metric">
            <dt>课程</dt>
            <dd class="mc-num">{{ courses.length }}</dd>
          </div>
          <div class="hall__metric">
            <dt>已学完课时</dt>
            <dd class="mc-num">{{ data?.orphans.finished ?? 0 }}</dd>
          </div>
          <div class="hall__metric">
            <dt>已完成练习</dt>
            <dd class="mc-num">{{ data?.orphans.quiz ?? 0 }}</dd>
          </div>
          <div class="hall__metric" :class="{ 'hall__metric--warn': (data?.orphans.total ?? 0) > 0 }">
            <dt>待归类课时</dt>
            <dd class="mc-num">{{ data?.orphans.total ?? 0 }}</dd>
          </div>
        </dl>
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

    <!-- 加载骨架：与真实列表同形（行式） -->
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

    <template v-else>
      <!-- ① 主推块：把最重要的动作放在最显眼处 -->
      <article
        v-if="featured"
        class="course-card course-card--featured mc-card"
        :class="`course-card--g${Math.abs(featured.id) % 6}`"
      >
        <RouterLink
          class="course-card__hero"
          :to="{ name: 'course', params: { id: featured.id } }"
          tabindex="-1"
          :aria-label="`进入课程 ${featured.name}`"
        >
          <img v-if="featured.cover" :src="`/api/v1/course-cover/${featured.id}`" :alt="featured.name" loading="lazy" />
          <span v-else class="course-card__hero-fallback" aria-hidden="true">
            <Icon name="graduation" :size="40" />
          </span>
        </RouterLink>

        <div class="course-card__hero-body">
          <div class="course-card__chips">
            <Tag v-if="featured.category_name" tone="primary" size="sm">{{ featured.category_name }}</Tag>
            <Tag v-if="featured.published !== 1" tone="warning" size="sm">草稿</Tag>
            <Tag v-if="progressOf(featured) >= 100" tone="success" size="sm" icon="check">已学完</Tag>
            <Tag v-else-if="progressOf(featured) > 0" tone="info" size="sm" icon="play">学习中</Tag>
            <Tag v-else tone="neutral" size="sm">未开始</Tag>
          </div>

          <RouterLink class="course-card__hero-name" :to="{ name: 'course', params: { id: featured.id } }">
            {{ featured.name }}
          </RouterLink>
          <p v-if="featured.description" class="course-card__hero-desc mc-clamp-2">{{ featured.description }}</p>

          <div class="course-card__hero-progress">
            <ProgressBar
              :value="progressOf(featured)"
              :tone="progressOf(featured) >= 100 ? 'success' : 'primary'"
              :label="`${featured.finished ?? 0}/${featured.total ?? 0}`"
            />
            <span class="course-card__hero-stat mc-muted">
              {{ featured.total ?? 0 }} 课时 · 已完成 {{ featured.finished ?? 0 }}
            </span>
          </div>

          <div class="course-card__hero-actions">
            <RouterLink class="mc-btn mc-btn--primary" :to="{ name: 'course', params: { id: featured.id } }">
              <Icon :name="progressOf(featured) > 0 ? 'play' : 'book-open'" :size="15" />
              {{ progressOf(featured) > 0 ? '继续学习' : '开始学习' }}
            </RouterLink>
            <button
              class="mc-btn mc-btn--ghost mc-btn--icon"
              :class="{ 'course-card__fav--on': featured.fav }"
              type="button"
              :aria-label="featured.fav ? '取消收藏' : '收藏课程'"
              :title="featured.fav ? '取消收藏' : '收藏课程'"
              @click="toggleFav(featured)"
            >
              <Icon name="star" :size="16" :filled="featured.fav" />
            </button>
          </div>
        </div>
      </article>

      <!-- ② 其余课程：按分类分组的紧凑列表（一屏看更多，层级靠分组与留白） -->
      <section v-for="group in groups" :key="group.name" class="hall__group">
        <header class="hall__group-head">
          <h2 class="hall__group-title">{{ group.name }}</h2>
          <span class="hall__group-count mc-num">{{ group.list.length }}</span>
        </header>

        <ul class="hall__list">
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
                class="mc-btn mc-btn--sm course-card__row-cta"
                :class="progressOf(course) > 0 ? 'mc-btn--soft' : 'mc-btn--ghost'"
                :to="{ name: 'course', params: { id: course.id } }"
              >
                {{ progressOf(course) > 0 ? '继续学习' : '开始学习' }}
              </RouterLink>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.hall {
  display: flex;
  flex-direction: column;
}

/* ---- 指标：一行文字，不占卡片位置（反模式 #20） ---- */
.hall__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-6);
  margin: 0;
}

.hall__metric {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
}

.hall__metric dt {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.hall__metric dd {
  margin: 0;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.hall__metric--warn dd {
  color: var(--mc-warning-fg);
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
  transition: var(--mc-transition-all);
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

/* ---- 主推块 ---- */
.course-card--featured {
  display: grid;
  grid-template-columns: 240px 1fr;
  overflow: hidden;
  margin-bottom: var(--mc-space-8);
}

.course-card__hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  background-image: var(--mc-gradient-brand-soft);
}

.course-card__hero img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.course-card__hero-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  border-radius: var(--mc-radius-xl);
  background-image: var(--mc-gradient-brand);
  color: var(--mc-neutral-0);
}

.course-card__hero-body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-6);
  min-width: 0;
}

.course-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
}

.course-card__hero-name {
  font-size: var(--mc-text-lg);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.course-card__hero-name:hover {
  color: var(--mc-primary-fg);
}

.course-card__hero-desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  max-width: 70ch;
}

.course-card__hero-progress {
  display: flex;
  align-items: center;
  gap: var(--mc-space-4);
  max-width: 520px;
}

.course-card__hero-progress :deep(.mc-progress) {
  flex: 1;
}

.course-card__hero-stat {
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.course-card__hero-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin-top: var(--mc-space-1);
}

/* ---- 分组 ---- */
.hall__group + .hall__group {
  margin-top: var(--mc-space-8);
}

.hall__group-head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
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

/* ---- 紧凑列表（不再是一整片同构卡片） ---- */
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

/* 按 id 稳定分配缩略图配色，避免整列同色 */
.course-card--g0 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-1);
  color: var(--mc-primary-fg);
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
.course-card--g4 .course-card__thumb {
  background-image: var(--mc-gradient-thumb-5);
  color: var(--mc-primary-fg);
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

.course-card__row-progress {
  min-width: 0;
}

.course-card__row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
}

.course-card__fav--on {
  color: var(--mc-warning-fg);
}

/* ---- 加载骨架 ---- */
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

/* ---- 窄屏：主推块改为上下、列表让出进度列 ---- */
@media (max-width: 900px) {
  .course-card--featured {
    grid-template-columns: 1fr;
  }

  .course-card__hero {
    min-height: 132px;
  }

  .course-card--row {
    grid-template-columns: 56px minmax(0, 1fr) auto;
  }

  .course-card__row-progress {
    display: none;
  }
}
</style>
