<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import Icon from '@/components/Icon.vue';
import type { Knowledge } from '@/api/types';

/** 侧栏知识点卡：文本（details 展开）/ 链接 / 附件三类。 */
defineProps<{ knowledge: Knowledge[] }>();
</script>

<template>
  <div class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">知识点</span>
      <span class="mc-muted">{{ knowledge.length }} 条</span>
    </div>
    <div class="knowledge">
      <EmptyState
        v-if="knowledge.length === 0"
        icon="list"
        title="暂无知识点"
        description="教师可在课时下补充讲义、链接或附件。"
      />
      <ol v-else class="knowledge__list">
        <li v-for="item in knowledge" :key="item.id" class="knowledge__item">
          <template v-if="item.kind === 'link'">
            <a :href="item.url" target="_blank" rel="noopener noreferrer"
              ><Icon name="arrow-right" :size="14" /> {{ item.title }}</a
            >
          </template>
          <template v-else-if="item.kind === 'file'">
            <a :href="`/api/v1/knowledge/${item.id}/file`" target="_blank" rel="noopener noreferrer">
              <Icon name="copy" :size="14" /> {{ item.title }}
            </a>
            <span class="mc-muted knowledge__file">{{ item.file_name }}</span>
          </template>
          <template v-else>
            <details>
              <summary><Icon name="list" :size="14" /> {{ item.title }}</summary>
              <p class="knowledge__content">{{ item.content }}</p>
            </details>
          </template>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.knowledge {
  padding: var(--mc-space-4) var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.knowledge__list {
  margin: 0;
  padding-left: var(--mc-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  font-size: var(--mc-text-sm);
}

.knowledge__file {
  display: block;
  font-size: var(--mc-text-xs);
}

.knowledge__content {
  margin: var(--mc-space-2) 0 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  white-space: pre-wrap;
}

.knowledge__item details summary {
  cursor: pointer;
}
</style>
