<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import Icon from '@/components/Icon.vue';
import type { useMediaRoots } from '@/composables/use-media-roots';

/**
 * 服务器目录选择器：进入子目录 / 返回上一级 / 选中当前目录。
 * 结果写回 use-media-roots 的 newRootPath，由「添加媒体目录」弹窗提交。
 */
defineProps<{ media: ReturnType<typeof useMediaRoots> }>();
</script>

<template>
  <AppModal :open="media.fsPickerOpen" title="选择服务器文件夹" width="620px" @close="media.closeFsPicker()">
    <div class="mc-col">
      <div class="mc-row mc-row--wrap">
        <span class="mc-muted mc-mono mc-truncate fs__path">{{ media.fsData?.path || '（选择磁盘）' }}</span>
        <div class="mc-spacer" />
        <button class="mc-btn mc-btn--sm" type="button" :disabled="!media.fsData?.parent" @click="media.fsUp()">
          上一级
        </button>
        <button class="mc-btn mc-btn--sm" type="button" :disabled="media.fsLoading" @click="media.loadFs(media.fsPath)">
          刷新
        </button>
      </div>

      <div v-if="media.fsLoading" class="mc-skeleton loading__row" />

      <ul v-else-if="(media.fsData?.dirs.length ?? 0) > 0" class="fs__list">
        <li v-for="dir in media.fsData?.dirs ?? []" :key="dir">
          <button class="fs__dir" type="button" @click="media.fsEnter(dir)">
            <Icon name="folder" :size="14" /> {{ dir }}
          </button>
        </li>
      </ul>

      <p v-else class="mc-muted">该目录下没有子文件夹，可以直接选当前目录。</p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="media.closeFsPicker()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="!media.fsData?.path" @click="media.fsPick()">
        选择当前目录
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.fs__path {
  max-width: 380px;
}

.fs__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.fs__dir {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  color: var(--mc-text);
}

.fs__dir:hover {
  background: var(--mc-bg-sunken);
}

.loading__row {
  height: 52px;
}
</style>
