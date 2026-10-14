<script setup lang="ts">
/**
 * 组卷「定范围」的范围树：册次 → 章节 → 知识点，三层都可勾选，节点带题量。
 *
 * 为什么这么设计（对齐全主流组卷系统）：
 *   - 老师是按**教材目录**想问题的（"我要第三单元"），不是按题库或 ID；
 *   - 真机上知识点有 5380 个，整棵展开既慢也没法用 → 章节下的知识点**按需加载 + 可搜索**；
 *   - 每层都显示「当前筛选下还剩多少题」，选之前就知道够不够出卷。
 *
 * 受控组件：勾选状态由父级持有（`selected`），本组件只负责展示与交互。
 */
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';
import type { FacetBook, FacetPoint } from '@/components/compose/types';

const props = withDefaults(
  defineProps<{
    books: FacetBook[];
    /** 已勾选（受控） */
    selected: { books: string[]; chapters: string[]; points: string[] };
    /** 某章节下已加载的知识点（懒加载结果按章节合并在这里） */
    pointsByChapter?: Record<string, FacetPoint[]>;
    loadingPoints?: string | null;
    emptyHint?: string;
  }>(),
  { pointsByChapter: () => ({}), loadingPoints: null, emptyHint: '当前筛选下没有题目' },
);

const emit = defineEmits<{
  'update:selected': [value: { books: string[]; chapters: string[]; points: string[] }];
  /** 需要加载某章节的知识点 */
  needPoints: [chapter: string];
  /** 知识点搜索（空串 = 清空搜索） */
  searchPoints: [keyword: string];
}>();

const expandedBooks = ref<string[]>([]);
const expandedChapters = ref<string[]>([]);
const pointSearch = ref('');

const isBookChecked = (book: string): boolean => props.selected.books.includes(book);
const isChapterChecked = (chapter: string): boolean => props.selected.chapters.includes(chapter);
const isPointChecked = (point: string): boolean => props.selected.points.includes(point);

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * 勾选册次：连带勾选它下面所有章节（整册出卷是常见操作）。
 * 取消时把该册的章节一起取消，避免"册次没选但章节还勾着"的诡异状态。
 */
function toggleBook(book: FacetBook): void {
  const checked = !isBookChecked(book.book);
  const chapters = book.chapters.map((c) => c.chapter);
  const nextBooks = toggle(props.selected.books, book.book);
  const nextChapters = checked
    ? [...new Set([...props.selected.chapters, ...chapters])]
    : props.selected.chapters.filter((c) => !chapters.includes(c));
  // 取消整册时，把该册章节下的知识点也一并清掉
  const nextPoints = checked
    ? props.selected.points
    : props.selected.points.filter((p) => !chapterPoints(book).includes(p));
  emit('update:selected', { books: nextBooks, chapters: nextChapters, points: nextPoints });
  if (checked) expandedBooks.value = [...new Set([...expandedBooks.value, book.book])];
}

function chapterPoints(book: FacetBook): string[] {
  return book.chapters.flatMap((c) => (props.pointsByChapter[c.chapter] ?? []).map((p) => p.point));
}

function toggleChapter(chapter: string): void {
  const checked = !isChapterChecked(chapter);
  const points = (props.pointsByChapter[chapter] ?? []).map((p) => p.point);
  emit('update:selected', {
    books: props.selected.books,
    chapters: toggle(props.selected.chapters, chapter),
    points: checked ? props.selected.points : props.selected.points.filter((p) => !points.includes(p)),
  });
}

function togglePoint(point: string): void {
  emit('update:selected', {
    books: props.selected.books,
    chapters: props.selected.chapters,
    points: toggle(props.selected.points, point),
  });
}

function toggleExpandChapter(chapter: string): void {
  const open = expandedChapters.value.includes(chapter);
  expandedChapters.value = open
    ? expandedChapters.value.filter((c) => c !== chapter)
    : [...expandedChapters.value, chapter];
  if (!open) emit('needPoints', chapter);
}

/** 已选知识点的展示文案（哨兵值显示成"未标注知识点"） */
function pointLabel(value: string): string {
  if (value === '__none__') return '（未标注知识点）';
  for (const list of Object.values(props.pointsByChapter)) {
    const hit = list.find((p) => p.point === value);
    if (hit) return hit.label;
  }
  return value;
}

function onSearch(): void {
  emit('searchPoints', pointSearch.value.trim());
}

const selectedCount = computed(
  () => props.selected.books.length + props.selected.chapters.length + props.selected.points.length,
);

function clearAll(): void {
  emit('update:selected', { books: [], chapters: [], points: [] });
  pointSearch.value = '';
  emit('searchPoints', '');
}

const ICONS: Record<string, IconName> = { book: 'book-open', chapter: 'list', point: 'target' };
void ICONS;
</script>

<template>
  <div class="tree">
    <div class="tree__head">
      <span class="mc-label">按教材章节 / 知识点选</span>
      <span class="mc-spacer" />
      <span v-if="selectedCount > 0" class="mc-muted tree__count">已选 {{ selectedCount }} 项</span>
      <button v-if="selectedCount > 0" class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="clearAll">
        清空
      </button>
    </div>

    <div class="tree__search">
      <Icon name="search" :size="15" />
      <input
        v-model.trim="pointSearch"
        class="mc-input"
        type="search"
        placeholder="搜索知识点（如 分数的意义）"
        aria-label="搜索知识点"
        @keyup.enter="onSearch"
      />
      <button class="mc-btn mc-btn--sm" type="button" @click="onSearch">搜索</button>
    </div>

    <div v-if="books.length === 0" class="tree__empty mc-muted">{{ emptyHint }}</div>

    <div v-else class="tree__scroll">
      <div v-for="book in books" :key="book.book" class="tree__book">
        <div class="tree__row tree__row--book">
          <button
            class="tree__expander"
            type="button"
            :aria-expanded="expandedBooks.includes(book.book)"
            :aria-label="`展开/收起 ${book.book}`"
            @click="
              expandedBooks = expandedBooks.includes(book.book)
                ? expandedBooks.filter((b) => b !== book.book)
                : [...expandedBooks, book.book]
            "
          >
            <Icon :name="expandedBooks.includes(book.book) ? 'chevron-down' : 'chevron-right'" :size="14" />
          </button>
          <label class="tree__check">
            <input type="checkbox" :checked="isBookChecked(book.book)" @change="toggleBook(book)" />
            <Icon name="book-open" :size="15" />
            <span class="tree__label">{{ book.label }}</span>
          </label>
          <span class="tree__badge">{{ book.count }}</span>
        </div>

        <div v-if="expandedBooks.includes(book.book)" class="tree__chapters">
          <div v-for="c in book.chapters" :key="c.chapter" class="tree__chapterblock">
            <div class="tree__row">
              <button
                class="tree__expander"
                type="button"
                :aria-expanded="expandedChapters.includes(c.chapter)"
                :aria-label="`展开/收起 ${c.chapter} 的知识点`"
                @click="toggleExpandChapter(c.chapter)"
              >
                <Icon :name="expandedChapters.includes(c.chapter) ? 'chevron-down' : 'chevron-right'" :size="13" />
              </button>
              <label class="tree__check">
                <input type="checkbox" :checked="isChapterChecked(c.chapter)" @change="toggleChapter(c.chapter)" />
                <span class="tree__label">{{ c.label }}</span>
              </label>
              <span class="tree__badge">{{ c.count }}</span>
            </div>

            <div v-if="expandedChapters.includes(c.chapter)" class="tree__points">
              <div v-if="loadingPoints === c.chapter" class="tree__loading mc-muted">加载知识点…</div>
              <template v-else>
                <div
                  v-for="p in pointsByChapter[c.chapter] ?? []"
                  :key="`${c.chapter}|${p.point}`"
                  class="tree__row tree__row--point"
                >
                  <span class="tree__expander" />
                  <label class="tree__check">
                    <input type="checkbox" :checked="isPointChecked(p.point)" @change="togglePoint(p.point)" />
                    <span class="tree__label">{{ p.label }}</span>
                  </label>
                  <span class="tree__badge">{{ p.count }}</span>
                </div>
                <div v-if="(pointsByChapter[c.chapter] ?? []).length === 0" class="tree__loading mc-muted">
                  这章没有匹配的知识点
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 已选知识点用标签列出来，方便一眼看到具体选了什么 -->
    <div v-if="selected.points.length > 0" class="tree__chips">
      <span class="mc-label">已选知识点</span>
      <span v-for="p in selected.points" :key="p" class="tree__chip">
        {{ pointLabel(p) }}
        <button class="tree__chipx" type="button" :aria-label="`取消选择 ${p}`" @click="togglePoint(p)">
          <Icon name="close" :size="12" />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.tree__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.tree__count {
  font-size: var(--mc-text-xs);
}

.tree__search {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
}

.tree__empty {
  padding: var(--mc-space-4);
  text-align: center;
  font-size: var(--mc-text-sm);
}

.tree__scroll {
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  padding: var(--mc-space-1);
  background: var(--mc-bg-elevated);
}

.tree__book + .tree__book {
  border-top: 1px solid var(--mc-border);
}

.tree__row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 30px;
  border-radius: var(--mc-radius-sm);
}

.tree__row:hover {
  background: var(--mc-bg-sunken);
}

.tree__row--book .tree__label {
  font-weight: var(--mc-font-medium);
}

.tree__chapters {
  padding-left: var(--mc-space-4);
}

.tree__points {
  padding-left: var(--mc-space-5);
}

.tree__row--point .tree__label {
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

.tree__expander {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--mc-text-muted);
  flex: none;
}

.tree__check {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.tree__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree__badge {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  font-variant-numeric: tabular-nums;
  padding-right: var(--mc-space-2);
  flex: none;
}

.tree__loading {
  font-size: var(--mc-text-xs);
  padding: var(--mc-space-1) var(--mc-space-4);
}

.tree__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tree__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
}

.tree__chipx {
  border: none;
  background: none;
  cursor: pointer;
  display: inline-flex;
  color: inherit;
  padding: 0;
}
</style>
