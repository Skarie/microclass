<script setup lang="ts">
import { ref } from 'vue';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import type { Knowledge } from '@/api/types';

/** 同一时间只展开一条知识点，避免右侧被长内容撑成一条长列表 */
const openId = ref<number | null>(null);

function toggle(id: number): void {
  openId.value = openId.value === id ? null : id;
}

/**
 * 导入的知识点是 Markdown 原文，标题语法（# / ##）不能直接渲染成正文，
 * 这里把标题行转成加粗行，其余内容交给 RichText（公式、图片照常渲染）。
 */
function renderContent(raw: string | null | undefined): string {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*#{1,6}\s+(.+)$/, '**$1**'))
    .join('\n');
}

/**
 * 观看页侧栏的一组知识点：文本（details 展开，支持导入的图片）/ 链接 / 附件。
 * 课时知识点与课程知识点共用；`title` 为空时不渲染分组标题（保持只有课时知识点的原样）。
 */
defineProps<{
  items: Knowledge[];
  title?: string;
  /** 分组标题下的补充说明，如「整门课共享」 */
  caption?: string;
}>();
</script>

<template>
  <section class="group">
    <div v-if="title" class="group__head">
      <span class="group__title">{{ title }}</span>
      <span v-if="caption" class="mc-muted group__caption">{{ caption }}</span>
      <span class="mc-muted group__count">{{ items.length }} 条</span>
    </div>
    <ul class="list">
      <li v-for="item in items" :key="item.id" class="item">
        <a v-if="item.kind === 'link'" class="item__row" :href="item.url" target="_blank" rel="noopener noreferrer">
          <Icon name="arrow-right" :size="14" />
          <span class="item__title">{{ item.title }}</span>
          <span class="mc-muted item__meta">外链</span>
        </a>
        <a
          v-else-if="item.kind === 'file'"
          class="item__row"
          :href="`/api/v1/knowledge/${item.id}/file`"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="copy" :size="14" />
          <span class="item__title">{{ item.title }}</span>
          <span class="mc-muted item__meta">{{ item.file_name }}</span>
        </a>
        <button
          v-else
          class="item__row item__row--toggle"
          type="button"
          :aria-expanded="openId === item.id"
          @click="toggle(item.id)"
        >
          <Icon name="list" :size="14" />
          <span class="item__title">{{ item.title }}</span>
          <Icon class="item__chevron" name="chevron-down" :size="14" />
        </button>
        <div v-if="openId === item.id" class="item__panel">
          <RichText class="item__content" :text="item.content" figure-images />
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.group__head {
  display: flex;
  align-items: baseline;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.group__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
}

.group__caption {
  font-size: var(--mc-text-xs);
}

.group__count {
  margin-left: auto;
  font-size: var(--mc-text-xs);
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.item {
  border-bottom: 1px solid var(--mc-border);
}

.item:last-child {
  border-bottom: 0;
}

.item__row {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  width: 100%;
  padding: var(--mc-space-2) 0;
  border: 0;
  background: none;
  color: var(--mc-text);
  font: inherit;
  font-size: var(--mc-text-sm);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.item__row:hover .item__title {
  color: var(--mc-primary-fg);
}

.item__row:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
  border-radius: var(--mc-radius-xs);
}

.item__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item__meta {
  flex: none;
  font-size: var(--mc-text-xs);
}

.item__chevron {
  flex: none;
  color: var(--mc-text-muted);
  transition: transform var(--mc-transition);
}

.item__row[aria-expanded='true'] .item__chevron {
  transform: rotate(180deg);
}

.item__panel {
  max-height: 360px;
  overflow-y: auto;
  padding-bottom: var(--mc-space-2);
}

.item__content {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}
</style>
