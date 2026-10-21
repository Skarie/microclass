<script setup lang="ts">
import type { useMediaRoots } from '@/composables/use-media-roots';

/**
 * 「媒体目录」筛选行：说明、刷新与添加媒体目录入口。
 */
defineProps<{ media: ReturnType<typeof useMediaRoots> }>();
</script>

<template>
  <div class="mc-row mc-row--wrap toolbar__row">
    <span class="mc-muted toolbar__count">
      媒体目录 = 服务器上允许被读取的视频文件夹（Docker / FPK
      需先把宿主机目录挂载进容器）。课程的「课程文件夹」只能从这些目录里选。
    </span>
    <div class="mc-spacer" />
    <button class="mc-btn mc-btn--sm" type="button" :disabled="media.rootsLoading" @click="media.loadRoots()">
      刷新
    </button>
    <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="media.openAddRoot">添加媒体目录</button>
  </div>
</template>

<style scoped>
.toolbar__row {
  align-items: center;
}

.toolbar__count {
  font-size: var(--mc-text-xs);
}
</style>
