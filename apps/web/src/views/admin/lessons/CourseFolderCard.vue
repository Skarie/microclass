<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import type { CourseManageResponse } from '@/api/types';

/**
 * 课程文件夹卡片：已绑定时显示路径 / 可访问性 / 上次扫描时间与扫描/更换/解绑，
 * 未绑定时引导选择文件夹。
 */
defineProps<{
  folder: CourseManageResponse['folder'];
  scanning: boolean;
}>();

const emit = defineEmits<{
  (e: 'scan'): void;
  (e: 'bind'): void;
  (e: 'unbind'): void;
}>();

/** 秒级时间戳 → 本地时间文案 */
function formatTime(seconds: number | null): string {
  if (!seconds) return '从未扫描';
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <section class="mc-card">
    <div class="mc-card__header">
      <span class="mc-card__title">课程文件夹</span>
      <span class="mc-muted">子文件夹将成为章节；以后往文件夹里加视频，点一次「扫描文件夹」即可</span>
    </div>

    <div class="mc-card__body folder">
      <template v-if="folder">
        <div class="folder__info">
          <div class="folder__path mc-mono">
            <Icon name="folder" :size="14" />
            {{ folder.rootName }}<template v-if="folder.path"> / {{ folder.path }}</template>
          </div>
          <div class="mc-row mc-row--wrap folder__meta">
            <span class="mc-badge" :class="folder.available ? 'mc-badge--success' : 'mc-badge--danger'">
              {{ folder.available ? '目录可访问' : '目录不可访问' }}
            </span>
            <span class="mc-muted">上次扫描：{{ formatTime(folder.lastScanAt) }}</span>
          </div>
        </div>
        <div class="mc-spacer" />
        <div class="mc-row mc-row--wrap">
          <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" :disabled="scanning" @click="emit('scan')">
            扫描更新
          </button>
          <button class="mc-btn mc-btn--sm" type="button" @click="emit('bind')">更换文件夹</button>
          <button class="mc-btn mc-btn--sm mc-btn--danger" type="button" @click="emit('unbind')">解绑</button>
        </div>
      </template>

      <template v-else>
        <div class="folder__empty mc-muted">
          还没有绑定视频文件夹。绑定后「扫描」即可把这个文件夹（含子文件夹）里的视频一次性导入成课时。
        </div>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--primary mc-btn--sm" type="button" @click="emit('bind')">选择文件夹</button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.folder {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  flex-wrap: wrap;
}

.folder__info {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.folder__path {
  font-weight: var(--mc-font-semibold);
  word-break: break-all;
}

.folder__meta {
  align-items: center;
  gap: var(--mc-space-3);
  font-size: var(--mc-text-xs);
}

.folder__empty {
  font-size: var(--mc-text-sm, 13px);
}
</style>
