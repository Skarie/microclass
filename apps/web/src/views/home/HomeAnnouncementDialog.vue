<script setup lang="ts">
/**
 * 首页公告的全文弹窗：级别、置顶、相对时间 + 完整正文（保留换行）。
 *
 * 独立成组件，让首页公告条只关心「哪两条、怎么排」；
 * 弹窗的样式也落在自己渲染的元素上（父组件的 scoped 样式进不来）。
 */
import AppModal from '@/components/AppModal.vue';
import Tag from '@/components/Tag.vue';
import { levelMeta, relativeDay } from '@/utils/announcement';
import type { Announcement } from '@/api/announcement';

defineProps<{ open: boolean; item: Announcement | null }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <AppModal :open="open" :title="item?.title ?? '公告'" width="560px" @close="emit('close')">
    <div v-if="item" class="ann-dialog">
      <p class="ann-dialog__meta">
        <Tag :tone="levelMeta(item.level).tone" size="sm">{{ levelMeta(item.level).label }}</Tag>
        <Tag v-if="item.pinned" tone="neutral" size="sm">置顶</Tag>
        <span class="ann-dialog__time">{{ relativeDay(item.createdAt) }}</span>
      </p>
      <p class="ann-dialog__body">{{ item.body }}</p>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--primary" type="button" @click="emit('close')">知道了</button>
    </template>
  </AppModal>
</template>

<style scoped>
.ann-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
}

.ann-dialog__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
}

.ann-dialog__time {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.ann-dialog__body {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
