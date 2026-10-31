<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import type { Knowledge, KnowledgeKind } from '@/api/types';

/**
 * 课程知识点卡片：整门课共享的知识点（文本 / 外链）的列表与入口。
 *
 * 数据与请求在 use-course-knowledge；这里只负责展示、触发编辑/删除，
 * 以及把整门课的知识点导出成 Markdown / Word（复用课程讲义导出接口）。
 */
defineProps<{
  items: Knowledge[];
  loading: boolean;
  exporting: boolean;
}>();

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'edit', item: Knowledge): void;
  (e: 'remove', item: Knowledge): void;
  (e: 'import-files'): void;
  (e: 'export-knowledge', format: 'md' | 'docx'): void;
}>();

function kindLabel(kind: KnowledgeKind): string {
  return kind === 'link' ? '外链' : '文本';
}

function kindClass(kind: KnowledgeKind): string {
  return kind === 'link' ? 'mc-badge--success' : 'mc-badge--primary';
}
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <div class="card-head">
        <span class="mc-card__title">课程知识点（{{ items.length }}）</span>
        <span class="mc-muted card-head__hint">整门课共享，学生在本课程每个课时的观看页都能看到</span>
      </div>
      <div class="mc-row mc-row--wrap">
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('import-files')">批量导入</button>
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('create')">新增知识点</button>
      </div>
    </div>

    <div class="mc-card__body">
      <div v-if="loading && items.length === 0" class="loading">
        <div v-for="i in 3" :key="i" class="mc-skeleton loading__row" />
      </div>

      <EmptyState
        v-else-if="items.length === 0"
        icon="list"
        title="还没有课程知识点"
        description="课程知识点属于整门课，适合放课程目标、学习方法和通用讲义；课时专属内容请到课时行里维护。"
        action-text="添加课程知识点"
        @action="emit('create')"
      />

      <ul v-else class="kn-list">
        <li v-for="item in items" :key="item.id" class="kn-item">
          <div class="kn-item__main">
            <div class="mc-row mc-row--wrap">
              <span class="mc-badge" :class="kindClass(item.kind)">{{ kindLabel(item.kind) }}</span>
              <strong>{{ item.title }}</strong>
            </div>
            <span v-if="item.kind === 'text'" class="mc-muted mc-clamp-2 kn-item__preview">{{
              item.content || '（空）'
            }}</span>
            <a v-else class="mc-muted mc-truncate kn-item__preview" :href="item.url" target="_blank" rel="noopener">{{
              item.url
            }}</a>
          </div>
          <div class="kn-item__actions">
            <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit', item)">编辑</button>
            <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="emit('remove', item)">删除</button>
          </div>
        </li>
      </ul>
    </div>

    <div class="mc-card__footer kn-footer">
      <span class="mc-muted kn-footer__hint">导出包含课程级与各课时的知识点，按「章节 → 课时」组织</span>
      <div class="mc-row mc-row--wrap">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="emit('export-knowledge', 'md')">
          导出 MD
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="exporting" @click="emit('export-knowledge', 'docx')">
          导出 Word
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card-head {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.card-head__hint {
  font-size: var(--mc-text-xs);
}

.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.loading__row {
  height: 48px;
}

.kn-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.kn-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
}

.kn-item__main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  flex: 1;
}

.kn-item__preview {
  font-size: var(--mc-text-xs);
}

.kn-item__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.kn-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
}

.kn-footer__hint {
  font-size: var(--mc-text-xs);
}
</style>
