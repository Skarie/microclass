<script setup lang="ts">
import { reactive } from 'vue';
import BankNavCrumbs from './BankNavCrumbs.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { useBankCatalog } from '@/composables/use-bank-catalog';

/**
 * 「按册次」左栏导航：册次列表 → 章节列表（题库列表由 BankListPanel 负责）。
 * 空串是真实分组键：册次 '' 显示「未归类册次」，章节 '' 显示「未分章」。
 */
const props = defineProps<{ catalog: ReturnType<typeof useBankCatalog> }>();
const catalogApi = props.catalog;
const catalogState = reactive(catalogApi);
</script>

<template>
  <div class="book-nav">
    <!-- 回填入口放在按册次视图的提示条里：这里正是「章节」概念出现的地方 -->
    <div class="book-nav__hint">
      <span class="mc-muted">章节缺失的题库可按课时或题库名自动补全。</span>
      <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="catalogState.openBackfill">
        批量回填章节
      </button>
    </div>

    <!-- 一级：全部册次（含未归类册次，后端已排好序） -->
    <template v-if="catalogState.bookBrowseLevel === 'books'">
      <div v-if="catalogState.bookCatalogLoading && catalogState.bookCatalog.length === 0" class="book-nav__loading">
        <div v-for="i in 4" :key="i" class="mc-skeleton loading__row" />
      </div>
      <EmptyState
        v-else-if="catalogState.bookCatalog.length === 0"
        icon="book-open"
        title="还没有可归类的题库"
        description="新建题库后填写册次与章节，这里就会按册次分组显示。"
      />
      <ul v-else class="nav-list">
        <li
          v-for="book in catalogState.bookCatalog"
          :key="book.book"
          class="nav-item"
          @click="catalogState.pickBook(book.book)"
        >
          <span class="nav-item__name">
            <span class="mc-truncate">{{ catalogState.bookLabel(book.book) }}</span>
            <span v-if="book.isUnbound" class="mc-badge mc-badge--warning">未归属</span>
          </span>
          <span class="mc-muted nav-item__meta">{{ book.bankCount }} 库 / {{ book.questionCount }} 题</span>
        </li>
      </ul>
    </template>

    <!-- 二级：某册次下的章节 -->
    <template v-else>
      <BankNavCrumbs
        :label="` / ${catalogState.bookLabel(catalogState.selectedBook?.book ?? '')}`"
        back-label="← 全部册次"
        @back="catalogState.clearBookPick"
      />
      <ul class="nav-list">
        <li
          v-for="section in catalogState.selectedBookSections"
          :key="section.section"
          class="nav-item"
          @click="catalogState.pickSection(section.section)"
        >
          <span class="mc-truncate">{{ catalogState.sectionLabel(section.section) }}</span>
          <span class="mc-muted nav-item__meta">{{ section.bankCount }} 库 / {{ section.questionCount }} 题</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.book-nav {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--mc-space-4);
}

.book-nav__hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-2);
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-subtle);
  font-size: var(--mc-text-xs);
}

.book-nav__loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  padding: var(--mc-space-2) 0;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
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
  gap: var(--mc-space-2);
  min-height: 42px;
  padding: var(--mc-space-3);
  border-radius: var(--mc-radius);
  cursor: pointer;
  font-size: var(--mc-text-base);
}

.nav-item:hover {
  background: var(--mc-surface-2);
}

.nav-item__name {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  flex: 1;
  min-width: 0;
}

.nav-item__name .mc-badge {
  flex: none;
}

.nav-item__meta {
  font-size: var(--mc-text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.loading__row {
  height: 42px;
}
</style>
