<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 添加目录表单由 use-media-roots 持有，弹窗就地编辑 */
import AppModal from '@/components/AppModal.vue';
import type { useMediaRoots } from '@/composables/use-media-roots';

/**
 * 添加媒体目录弹窗：显示名称 + 服务器路径（只读，必须通过目录选择器填写）。
 */
defineProps<{ media: ReturnType<typeof useMediaRoots> }>();
</script>

<template>
  <AppModal :open="media.addRootOpen" title="添加媒体目录" width="640px" @close="media.closeAddRoot()">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">显示名称</span>
        <input
          v-model="media.newRootName"
          class="mc-input"
          type="text"
          maxlength="60"
          placeholder="例如：计算机基础视频"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label mc-label--required">服务器文件夹路径</span>
        <div class="mc-row">
          <input v-model="media.newRootPath" class="mc-input" type="text" readonly placeholder="点击右侧按钮选择目录" />
          <button class="mc-btn mc-btn--sm" type="button" @click="media.openFsPicker()">浏览目录</button>
        </div>
        <span class="mc-hint">
          Docker / FPK 部署时请先确认该文件夹已挂载进容器（见 docs/deploy.md）；容器以非 root 运行，还需保证它有读权限。
        </span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="media.closeAddRoot()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="media.rootSaving" @click="media.addRoot()">
        {{ media.rootSaving ? '添加中…' : '添加' }}
      </button>
    </template>
  </AppModal>
</template>
