<script setup lang="ts">
/**
 * 课程大厅：欢迎条 → 分类 chips → 搜索/筛选/视图 → 按分类分组的课程。
 *
 * 数据与筛选在 composables/use-hall-catalog.ts；
 * 界面按「欢迎条 / 分类 chips / 工具条 / 平铺卡片 / 列表行 / 封面 / 骨架」拆分。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import PageHeader from '@/components/PageHeader.vue';
import SectionHead from '@/components/SectionHead.vue';
import { useHallCatalog } from '@/composables/use-hall-catalog';
import HallWelcome from './hall/HallWelcome.vue';
import HallCategoryChips from './hall/HallCategoryChips.vue';
import HallToolbar from './hall/HallToolbar.vue';
import HallCourseCard from './hall/HallCourseCard.vue';
import HallCourseRow from './hall/HallCourseRow.vue';
import HallSkeleton from './hall/HallSkeleton.vue';

const catalog = useHallCatalog();

/**
 * 滚动位置记忆：点开课程再返回时回到原来那一行。
 * 路由的 scrollBehavior 只在浏览器前进/后退给 saved，异步列表往往还没渲染完就被它置顶，
 * 所以这里等数据渲染后再恢复一次；5 分钟内的记录才生效，避免从导航重新进入时莫名其妙跳到中间。
 */
const SCROLL_KEY = 'mc:hall-scroll';
const restored = ref(false);

function readSavedScroll(): number {
  const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
  const at = Number(sessionStorage.getItem(`${SCROLL_KEY}:at`) ?? 0);
  return Number.isFinite(y) && Date.now() - at < 5 * 60 * 1000 ? y : 0;
}

onMounted(() => {
  if (catalog.loading) return;
  const y = readSavedScroll();
  if (y > 0) void nextTick(() => window.scrollTo({ top: y, behavior: 'auto' }));
});

watch(
  () => catalog.filtered.length,
  async (count) => {
    if (restored.value || count === 0) return;
    restored.value = true;
    const y = readSavedScroll();
    if (y > 0) {
      await nextTick();
      window.scrollTo({ top: y, behavior: 'auto' });
    }
  },
);

onBeforeUnmount(() => {
  sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  sessionStorage.setItem(`${SCROLL_KEY}:at`, String(Date.now()));
});
</script>

<template>
  <section class="hall">
    <PageHeader
      title="课程大厅"
      description="按分类浏览课程；进入课程查看章节与课时。"
      icon="hall"
      :breadcrumb="[{ label: '首页', to: '/' }, { label: '课程大厅' }]"
    >
      <template #actions>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="catalog.loading" @click="catalog.refresh()">
          <span v-if="catalog.loading" class="mc-btn__spinner" aria-hidden="true" />
          <Icon v-else name="refresh" :size="16" />
          {{ catalog.loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </PageHeader>

    <div class="hall__body">
      <HallWelcome :catalog="catalog" />

      <div class="hall__filters">
        <HallCategoryChips :catalog="catalog" />
        <HallToolbar :catalog="catalog" />
      </div>

      <div id="hall-list" class="hall__results">
        <HallSkeleton v-if="catalog.loading && catalog.courses.length === 0" :view-mode="catalog.viewMode" />

        <EmptyState
          v-else-if="catalog.filtered.length === 0"
          icon="search"
          title="没有匹配的课程"
          description="换个关键词或清空筛选条件试试。若还没有课程，请联系管理员在「课程管理」中创建。"
          action-text="重置筛选"
          @action="catalog.resetFilters"
        />

        <template v-else>
          <section class="hall__group">
            <SectionHead :title="catalog.activeCategoryName">
              <template #meta
                ><span class="mc-num">{{ catalog.filtered.length }} 门</span></template
              >
            </SectionHead>

            <div
              v-if="catalog.viewMode === 'cards'"
              :key="`cards-${catalog.categoryId}`"
              class="hall__cards mc-fade-in"
            >
              <HallCourseCard
                v-for="course in catalog.filtered"
                :key="course.id"
                :course="course"
                :progress="catalog.progressOf(course)"
                @toggle-fav="catalog.toggleFav"
              />
            </div>

            <ul v-else :key="`list-${catalog.categoryId}`" class="hall__list mc-fade-in">
              <HallCourseRow
                v-for="course in catalog.filtered"
                :key="course.id"
                :course="course"
                :progress="catalog.progressOf(course)"
                @toggle-fav="catalog.toggleFav"
              />
            </ul>
          </section>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hall {
  display: flex;
  flex-direction: column;
}

.hall__body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-8);
  margin-top: var(--mc-space-2);
}

.hall__filters {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
}

.hall__results {
  display: flex;
  flex-direction: column;
}

.hall__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: var(--mc-space-4);
}

.hall__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
