<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import type { Knowledge, KnowledgeKind } from '@/api/types';

/**
 * 知识点列表：文本 / 外链 / 附件三类条目的展示与行内操作。
 * 从 KnowledgeModal 抽出，弹窗本身只负责表单与增删改。
 */
defineProps<{
  items: Knowledge[];
  loading: boolean;
}>();

const emit = defineEmits<{ edit: [item: Knowledge]; remove: [item: Knowledge] }>();

function kindLabel(kind: KnowledgeKind): string {
  if (kind === 'file') return '附件';
  if (kind === 'link') return '外链';
  return '文本';
}

/** 条目预览：去掉 Markdown 标题/图片/链接语法，压成纯文本，避免出现超长原始语法串 */
function previewOf(item: Knowledge): string {
  if (item.kind === 'link') return item.url ?? '';
  if (item.kind === 'file') return `附件：${item.file_name ?? ''}`;
  const text = (item.content ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? '（空）' : text;
}
</script>

<template>
  <div v-if="loading" class="mc-skeleton loading__row" />
  <EmptyState
    v-else-if="items.length === 0"
    icon="copy"
    title="该课时还没有知识点"
    description="可以添加文本讲义、外部链接，或直接上传课件附件。"
  />
  <ul v-else class="kn-list">
    <li v-for="item in items" :key="item.id" class="kn-item">
      <div class="kn-item__main">
        <div class="kn-item__head">
          <span
            class="mc-badge"
            :class="item.kind === 'file' ? 'mc-badge--primary' : item.kind === 'link' ? 'mc-badge--success' : ''"
          >
            {{ kindLabel(item.kind) }}
          </span>
          <strong class="kn-item__title">{{ item.title }}</strong>
        </div>
        <span class="mc-muted kn-item__preview">{{ previewOf(item) }}</span>
      </div>
      <div class="kn-item__actions">
        <a
          v-if="item.kind === 'file'"
          class="mc-btn mc-btn--sm"
          :href="`/api/v1/knowledge/${item.id}/file`"
          target="_blank"
          rel="noopener"
        >
          下载
        </a>
        <a v-else-if="item.kind === 'link'" class="mc-btn mc-btn--sm" :href="item.url" target="_blank" rel="noopener">
          打开
        </a>
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit', item)">编辑</button>
        <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="emit('remove', item)">删除</button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.loading__row {
  height: 48px;
}

.kn-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}

.kn-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) 0;
  border-bottom: 1px solid var(--mc-border);
}

.kn-item:last-child {
  border-bottom: 0;
}

.kn-item__main {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
  flex: 1;
}

.kn-item__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.kn-item__title {
  color: var(--mc-text);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
}

.kn-item__preview {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-snug);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.kn-item__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
