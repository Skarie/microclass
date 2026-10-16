<script setup lang="ts">
/**
 * 课程大厅（首页 · 机构门面版）
 *
 * 结构（对标大机构/主流教育平台首页）：
 *   ① 主视觉 Hero：品牌主张 + 大搜索框 + 主 CTA（浏览全部课程 / 刷新）
 *   ② 实力数据带：真实数据（课程/课时/分类/已学完/在学）—— 首页需要可信度
 *   ③ 分类金刚区：按分类快速进入（点击即筛选）
 *   ④ 继续学习：主推块（优先"学到一半"的课程）
 *   ⑤ 全部课程：按分类分组的紧凑列表
 *
 * 数据全部取自真实接口，不造数、不夸大。
 * 测试钩子：课程项仍带 `course-card` 类名，CTA 文案保持「开始学习 / 继续学习」。
 */
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/client';
import { useAsync, errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
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

/* ---- 首页实力数据带：全部是真实统计 ---- */
const lessonTotal = computed(() => courses.value.reduce((sum, c) => sum + (c.total ?? 0), 0));
const finishedTotal = computed(() => courses.value.reduce((sum, c) => sum + (c.finished ?? 0), 0));
const learningCount = computed(() => courses.value.filter((c) => progressOf(c) > 0 && progressOf(c) < 100).length);

const overviewStats = computed(() => [
  { label: '门课程', value: courses.value.length },
  { label: '个课时', value: lessonTotal.value },
  { label: '个分类', value: categories.value.length },
  { label: '个课时已学完', value: finishedTotal.value },
]);

/* ---- 分类金刚区：每类课程数与该类整体进度 ---- */
const categoryTiles = computed(() =>
  categories.value
    .map((cat) => {
      const list = courses.value.filter((c) => c.category_id === cat.id);
      const total = list.reduce((s, c) => s + (c.total ?? 0), 0);
      const done = list.reduce((s, c) => s + (c.finished ?? 0), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: list.length,
        percent: total > 0 ? Math.round((done / total) * 100) : 0,
      };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8),
);

const uncategorizedCount = computed(() => courses.value.filter((c) => !c.category_id).length);

function pickCategory(id: number): void {
  categoryId.value = categoryId.value === id ? '' : id;
}

/** 主推块：优先"学到一半"的课程 */
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
    <!-- ① 主视觉：品牌主张 + 搜索 + 主 CTA -->
    <header class="hall__hero">
      <div class="hall__hero-main">
        <p class="hall__eyebrow">
          <Icon name="graduation" :size="15" />
          微课堂 · 一站式轻量学习平台
        </p>
        <h1 class="hall__claim">看的每一分钟，都算数</h1>
        <p class="hall__sub">课程视频、章节归类、课后练习与错题本一体；本地视频断点续播，练习按知识点自动归档。</p>

        <div class="hall__hero-search">
          <label class="hall__search hall__search--hero">
            <Icon name="search" :size="16" />
            <input
              v-model.trim="keyword"
              class="mc-input mc-input--search hall__search-input"
              type="search"
              placeholder="搜索课程名称或简介"
              aria-label="搜索课程"
            />
          </label>
          <button class="mc-btn mc-btn--primary hall__hero-cta" type="button" @click="resetFilters">
            <Icon name="grid" :size="15" />
            浏览全部课程
          </button>
          <button class="mc-btn hall__hero-cta" type="button" :disabled="loading" title="刷新课程数据" @click="run()">
            <Icon name="refresh" :size="15" />
            刷新
          </button>
        </div>

        <!-- ② 实力数据带（真实数据） -->
        <dl class="hall__stats">
          <div v-for="s in overviewStats" :key="s.label" class="hall__stat">
            <dt class="mc-num hall__stat-num">{{ s.value }}</dt>
            <dd class="hall__stat-label">{{ s.label }}</dd>
          </div>
          <div v-if="learningCount > 0" class="hall__stat hall__stat--accent">
            <dt class="mc-num hall__stat-num">{{ learningCount }}</dt>
            <dd class="hall__stat-label">门在学</dd>
          </div>
        </dl>
      </div>

      <div class="hall__hero-art" aria-hidden="true">
        <span class="hall__art-ring" />
        <span class="hall__art-card hall__art-card--a"><Icon name="play" :size="22" /></span>
        <span class="hall__art-card hall__art-card--b"><Icon name="check-circle" :size="20" /></span>
        <span class="hall__art-card hall__art-card--c"><Icon name="chartBar" :size="20" /></span>
      </div>
    </header>

    <!-- ③ 分类金刚区 -->
    <nav v-if="categoryTiles.length > 0 || uncategorizedCount > 0" class="hall__cats" aria-label="按分类浏览">
      <button
        v-for="cat in categoryTiles"
        :key="cat.id"
        class="hall__cat"
        :class="{ 'hall__cat--on': categoryId === cat.id }"
        type="button"
        :aria-pressed="categoryId === cat.id"
        @click="pickCategory(cat.id)"
      >
        <span class="hall__cat-icon"><Icon name="book-open" :size="18" /></span>
        <span class="hall__cat-text">
          <span class="hall__cat-name">{{ cat.name }}</span>
          <span class="hall__cat-meta mc-num">{{ cat.count }} 门 · {{ cat.percent }}%</span>
        </span>
      </button>
      <div v-if="uncategorizedCount > 0" class="hall__cat hall__cat--muted">
        <span class="hall__cat-icon"><Icon name="folder" :size="18" /></span>
        <span class="hall__cat-text">
          <span class="hall__cat-name">未分类</span>
          <span class="hall__cat-meta mc-num">{{ uncategorizedCount }} 门</span>
        </span>
      </div>
    </nav>

    <Toolbar>
      <template #left>
        <label class="hall__search">
          <Icon name="search" :size="15" />
          <input
            v-model.trim="keyword"
            class="mc-input mc-input--search hall__search-input"
            type="search"
            placeholder="搜索课程名称或简介"
            aria-label="搜索课程（工具条）"
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
        <span v-if="keyword || categoryId !== '' || onlyFav || onlyUnfinished" class="mc-muted hall__count">
          筛选出 {{ filtered.length }} / {{ courses.length }} 门
        </span>
        <button class="mc-btn mc-btn--sm mc-btn--ghost" type="button" @click="resetFilters">
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

    <template v-else>
      <!-- ④ 继续学习：主推块 -->
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

      <!-- ⑤ 全部课程：按分类分组的紧凑列表 -->
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

/* ---------- ① 主视觉 ---------- */
.hall__hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--mc-space-6);
  padding: var(--mc-space-8);
  margin-bottom: var(--mc-space-6);
  overflow: hidden;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  background-image: var(--mc-gradient-brand-soft);
  box-shadow: var(--mc-shadow-sm);
}

.hall__hero-main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  min-width: 0;
}

.hall__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-medium);
  letter-spacing: 0.06em;
  color: var(--mc-primary-fg);
}

.hall__claim {
  margin: 0;
  font-size: var(--mc-text-2xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  letter-spacing: var(--mc-tracking-tight);
  color: var(--mc-text);
}

.hall__sub {
  max-width: 62ch;
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

.hall__hero-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2);
  margin-top: var(--mc-space-2);
}

.hall__search--hero {
  min-width: 320px;
  flex: 1 1 320px;
}

.hall__hero-cta {
  flex: none;
}

/* 实力数据带 */
.hall__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-6);
  margin: var(--mc-space-4) 0 0;
}

.hall__stat {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding-left: var(--mc-space-4);
  border-left: 1px solid var(--mc-border);
}

.hall__stat:first-child {
  padding-left: 0;
  border-left: 0;
}

.hall__stat-num {
  font-size: var(--mc-text-xl);
  font-weight: var(--mc-font-bold);
  line-height: var(--mc-leading-display);
  color: var(--mc-text);
}

.hall__stat-label {
  margin: 0;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.hall__stat--accent .hall__stat-num {
  color: var(--mc-primary-fg);
}

/* 主视觉装饰（纯装饰，aria-hidden） */
.hall__hero-art {
  display: none;
}

@media (min-width: 1080px) {
  .hall__hero {
    grid-template-columns: minmax(0, 1fr) 240px;
  }

  .hall__hero-art {
    position: relative;
    display: block;
  }

  .hall__art-ring {
    position: absolute;
    top: 34px;
    left: 60px;
    width: 96px;
    height: 96px;
    border-radius: var(--mc-radius-pill);
    border: 2px dashed var(--mc-primary-border);
  }

  .hall__art-card {
    position: absolute;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--mc-radius-lg);
    background: var(--mc-bg-elevated);
    box-shadow: var(--mc-shadow-md);
  }

  .hall__art-card--a {
    top: 0;
    left: 0;
    width: 64px;
    height: 64px;
    color: var(--mc-primary-fg);
  }

  .hall__art-card--b {
    top: 78px;
    right: 6px;
    width: 48px;
    height: 48px;
    color: var(--mc-success-fg);
  }

  .hall__art-card--c {
    bottom: 4px;
    left: 12px;
    width: 52px;
    height: 52px;
    color: var(--mc-accent-fg);
  }
}

/* ---------- ③ 分类金刚区 ---------- */
.hall__cats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--mc-space-3);
  margin-bottom: var(--mc-space-6);
}

.hall__cat {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  text-align: left;
  cursor: pointer;
  transition: var(--mc-transition-all);
}

@media (hover: hover) and (pointer: fine) {
  .hall__cat:hover {
    border-color: var(--mc-primary-border);
    box-shadow: var(--mc-shadow-sm);
  }
}

.hall__cat--on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.hall__cat--muted {
  cursor: default;
  opacity: 0.85;
}

.hall__cat-icon {
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

.hall__cat-text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.hall__cat-name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-medium);
  color: var(--mc-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall__cat-meta {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  white-space: nowrap;
}

/* ---------- 工具条搜索框 ---------- */
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

/* ---------- ④ 主推块 ---------- */
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

/* ---------- ⑤ 分组与列表 ---------- */
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

/* ---------- 加载骨架 ---------- */
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

/* ---------- 窄屏 ---------- */
@media (max-width: 900px) {
  .hall__hero {
    padding: var(--mc-space-6) var(--mc-space-5);
  }

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
