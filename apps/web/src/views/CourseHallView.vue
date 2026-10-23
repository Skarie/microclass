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
 *
 * 页面只做编排：数据与筛选在 composables/use-hall-catalog.ts；
 * 界面按「工具条 / 平铺卡片 / 列表行 / 封面 / 骨架」拆到 ./hall/*。
 */
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useHallCatalog } from '@/composables/use-hall-catalog';
import HallCourseCard from './hall/HallCourseCard.vue';
import HallCourseRow from './hall/HallCourseRow.vue';
import HallSkeleton from './hall/HallSkeleton.vue';
import HallToolbar from './hall/HallToolbar.vue';

const catalog = useHallCatalog();
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
        <button class="mc-btn mc-btn--sm" type="button" :disabled="catalog.loading" @click="catalog.refresh()">
          <Icon name="refresh" :size="15" />
          刷新
        </button>
      </template>
    </PageHeader>

    <HallToolbar :catalog="catalog" />

    <HallSkeleton v-if="catalog.loading && catalog.courses.length === 0" />

    <EmptyState
      v-else-if="catalog.filtered.length === 0"
      icon="search"
      title="没有匹配的课程"
      description="换个关键词或清空筛选条件试试。若还没有课程，请联系管理员在「课程管理」中创建。"
      action-text="重置筛选"
      @action="catalog.resetFilters"
    />

    <section v-for="group in catalog.groups" v-else :key="group.name" class="hall__group">
      <header class="hall__group-head">
        <h2 class="hall__group-title">{{ group.name }}</h2>
        <span class="hall__group-count mc-num">{{ group.list.length }}</span>
      </header>

      <!-- 卡片网格 -->
      <div v-if="catalog.viewMode === 'cards'" class="hall__cards">
        <HallCourseCard
          v-for="course in group.list"
          :key="course.id"
          :course="course"
          :progress="catalog.progressOf(course)"
          @toggle-fav="catalog.toggleFav"
        />
      </div>

      <!-- 紧凑列表 -->
      <ul v-else class="hall__list">
        <HallCourseRow
          v-for="course in group.list"
          :key="course.id"
          :course="course"
          :progress="catalog.progressOf(course)"
          @toggle-fav="catalog.toggleFav"
        />
      </ul>
    </section>
  </section>
</template>

<style scoped>
.hall {
  display: flex;
  flex-direction: column;
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

/* 紧凑列表 */
.hall__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
