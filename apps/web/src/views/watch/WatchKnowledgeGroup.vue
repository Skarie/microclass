<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import type { Knowledge } from '@/api/types';

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
    <ol class="list">
      <li v-for="item in items" :key="item.id" class="item">
        <template v-if="item.kind === 'link'">
          <a :href="item.url" target="_blank" rel="noopener noreferrer"
            ><Icon name="arrow-right" :size="14" /> {{ item.title }}</a
          >
        </template>
        <template v-else-if="item.kind === 'file'">
          <a :href="`/api/v1/knowledge/${item.id}/file`" target="_blank" rel="noopener noreferrer">
            <Icon name="copy" :size="14" /> {{ item.title }}
          </a>
          <span class="mc-muted item__file">{{ item.file_name }}</span>
        </template>
        <template v-else>
          <details>
            <summary><Icon name="list" :size="14" /> {{ item.title }}</summary>
            <RichText class="item__content" :text="item.content" figure-images />
          </details>
        </template>
      </li>
    </ol>
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
  padding-left: var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
}

.item__file {
  display: block;
  font-size: var(--mc-text-xs);
}

.item__content {
  margin: var(--mc-space-2) 0 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
}

.item details summary {
  cursor: pointer;
}
</style>
