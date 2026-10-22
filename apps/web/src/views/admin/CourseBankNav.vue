<script setup lang="ts">
import { reactive } from 'vue';
import BankNavCrumbs from './BankNavCrumbs.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';
import type { useBankActions } from '@/composables/use-bank-actions';

/**
 * 左栏逐级导航（从 BankAdminView 抽出）：
 * 一级课程列表（未归属课程置顶）、二级未归属册次列表与「挂到课程」。
 * 题库列表层由 BankListPanel 负责，这里只在课程 / 册次层渲染。
 */
const props = defineProps<{
  catalog: ReturnType<typeof useBankCatalog>;
  actions: ReturnType<typeof useBankActions>;
}>();

const catalogApi = props.catalog;
const actionsApi = props.actions;
const catalogState = reactive(catalogApi);
const actionsState = reactive(actionsApi);
</script>

<template>
  <!-- 一级：课程列表（"未归属课程"置顶）；搜索时自动跳到搜索结果 -->
  <ul v-if="catalogState.browseLevel === 'courses'" class="nav-list">
    <li class="nav-item" @click="catalogState.pickUnbound('')">
      <span class="mc-truncate">未归属课程</span>
      <span class="mc-muted nav-item__meta">
        {{ catalogState.catalog.unbound.bankCount }} 库 / {{ catalogState.catalog.unbound.questionCount }} 题
      </span>
    </li>
    <li
      v-for="course in catalogState.visibleCourses"
      :key="course.id"
      class="nav-item"
      @click="catalogState.pickCourse(course.id)"
    >
      <span class="mc-truncate">{{ course.name }}</span>
      <span class="mc-muted nav-item__meta">{{ course.bankCount }} 库 / {{ course.questionCount }} 题</span>
    </li>
  </ul>

  <!-- 二级：未归属课程 → 按册次分组 -->
  <template v-else-if="catalogState.browseLevel === 'books'">
    <BankNavCrumbs label="/ 未归属课程" @back="catalogState.pickCourse(null)" />
    <ul class="nav-list">
      <li
        v-for="item in catalogState.catalog.unboundBooks"
        :key="item.book"
        class="nav-item"
        @click="catalogState.pickUnbound(item.book)"
      >
        <span class="mc-truncate">{{ item.book }}</span>
        <span class="mc-muted nav-item__meta">{{ item.bankCount }} 库 / {{ item.questionCount }} 题</span>
        <!-- 1700+ 个未归属题库一个个挂太费事：按册次一次挂完 -->
        <button
          v-if="catalogState.catalog.courses.length > 0"
          class="mc-btn mc-btn--ghost mc-btn--sm nav-item__bind"
          type="button"
          @click.stop="actionsState.openBindBook(item)"
        >
          挂到课程
        </button>
      </li>
    </ul>
    <button
      class="mc-btn mc-btn--ghost mc-btn--sm tree__rebind"
      type="button"
      :disabled="catalogState.rebinding"
      @click="catalogState.rebind"
    >
      {{ catalogState.rebinding ? '匹配中…' : '自动匹配课程归属' }}
    </button>
  </template>
</template>

<style scoped>
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  max-height: 46vh;
  overflow: auto;
}

.nav-item {
  /* flex 列可滚动时行默认允许收缩，会压扁两行名字；禁止收缩 */
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  padding: var(--mc-space-3) var(--mc-space-3);
  border-radius: var(--mc-radius);
  cursor: pointer;
  font-size: var(--mc-text-base);
}

.nav-item:hover {
  background: var(--mc-surface-2);
}

.nav-item__meta {
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 册次行的「挂到课程」：默认低调，悬停该行才显现 */
.nav-item__bind {
  flex: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.nav-item:hover .nav-item__bind,
.nav-item:focus-within .nav-item__bind {
  opacity: 1;
}

@media (hover: none) {
  .nav-item__bind {
    opacity: 1;
  }
}

.tree__rebind {
  margin: var(--mc-space-2) 0 0 8px;
}
</style>
