<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue';
import type { useMediaRoots } from '@/composables/use-media-roots';

/**
 * 「媒体目录」：已登记的服务器视频文件夹列表（内置目录不可移除）。
 * 增删逻辑在 use-media-roots，这里只负责展示与触发。
 */
defineProps<{ media: ReturnType<typeof useMediaRoots> }>();
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">媒体目录（{{ media.roots.length }}）</span>
      <span class="mc-muted">只登记路径、不复制视频；播放时按 HTTP Range 直接读原文件</span>
    </div>

    <div v-if="media.rootsLoading && media.roots.length === 0" class="loading">
      <div v-for="i in 3" :key="i" class="mc-skeleton loading__row" />
    </div>

    <EmptyState
      v-else-if="media.roots.length === 0"
      icon="folder"
      title="还没有媒体目录"
      description="添加一个服务器上的视频文件夹后，课程才能把它绑定为「课程文件夹」并扫描导入课时。"
      action-text="添加媒体目录"
      @action="media.openAddRoot()"
    />

    <ul v-else class="root-list">
      <li v-for="root in media.roots" :key="root.id" class="root-item">
        <div class="root-item__info">
          <div class="mc-row mc-row--wrap root-item__title">
            <strong>{{ root.name }}</strong>
            <span v-if="root.internal" class="mc-badge">内置</span>
            <span v-if="root.available === false" class="mc-badge mc-badge--danger">不可访问</span>
            <span v-else class="mc-badge mc-badge--success">可用</span>
            <span class="mc-muted root-item__lessons">{{ root.lessons ?? 0 }} 个课时在用</span>
          </div>
          <span class="mc-muted mc-mono mc-truncate root-item__path">{{ root.path }}</span>
        </div>
        <div class="row-actions">
          <button
            v-if="!root.internal"
            class="mc-btn mc-btn--danger mc-btn--sm"
            type="button"
            @click="media.removeRoot(root)"
          >
            移除
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.loading {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  padding: var(--mc-space-5);
}

.loading__row {
  height: 52px;
}

.root-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.root-item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-5);
  border-bottom: 1px solid var(--mc-border);
  flex-wrap: wrap;
}

.root-item__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.root-item__title {
  align-items: center;
  gap: var(--mc-space-2);
}

.root-item__lessons,
.root-item__path {
  font-size: var(--mc-text-xs);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}
</style>
