<script setup lang="ts">
/**
 * 管理端 · 公告列表行：标题 / 置顶 / 级别 / 发布状态 / 发布时间 / 编辑删除。
 *
 * 只负责一行的渲染与两个动作事件（编辑、删除），排序与请求都在父级与 composable；
 * 样式跟元素走，写在行组件里（父组件的 scoped 样式进不来）。
 */
import Tag from '@/components/Tag.vue';
import { formatStamp, levelMeta, summaryOf } from '@/utils/announcement';
import type { Announcement } from '@/api/announcement';

defineProps<{ item: Announcement; removing: boolean }>();
const emit = defineEmits<{ edit: []; remove: [] }>();
</script>

<template>
  <li class="ann-row">
    <div class="ann-row__title">
      <span class="ann-row__name">{{ item.title }}</span>
      <Tag v-if="item.pinned" tone="warning" size="sm">置顶</Tag>
    </div>

    <div class="ann-row__meta">
      <Tag :tone="levelMeta(item.level).tone" size="sm">{{ levelMeta(item.level).label }}</Tag>
      <Tag :tone="item.published === false ? 'neutral' : 'success'" size="sm">
        {{ item.published === false ? '草稿' : '已发布' }}
      </Tag>
      <span class="ann-row__body">{{ summaryOf(item.body, 80) }}</span>
    </div>

    <div class="ann-row__foot">
      <span class="ann-row__time">{{ formatStamp(item.createdAt) }}</span>
      <span class="ann-row__ops">
        <button class="mc-btn mc-btn--sm" type="button" @click="emit('edit')">编辑</button>
        <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" :disabled="removing" @click="emit('remove')">
          删除
        </button>
      </span>
    </div>
  </li>
</template>

<style scoped>
.ann-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mc-space-2) var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-top: 1px solid var(--mc-border);
}

.ann-row__title {
  display: flex;
  flex: 1 1 260px;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.ann-row__name {
  overflow: hidden;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-row__meta {
  display: flex;
  flex: 1 1 320px;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.ann-row__body {
  flex: 1;
  overflow: hidden;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ann-row__foot {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  margin-left: auto;
}

.ann-row__time {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.ann-row__ops {
  display: flex;
  gap: var(--mc-space-2);
}

@media (max-width: 900px) {
  .ann-row {
    padding: var(--mc-space-3) var(--mc-space-4);
  }

  .ann-row__foot {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }

  .ann-row__ops .mc-btn {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
