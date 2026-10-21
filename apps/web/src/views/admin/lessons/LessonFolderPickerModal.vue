<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';
import Icon from '@/components/Icon.vue';
import type { useCourseFolder } from '@/composables/use-course-folder';

/**
 * 课程文件夹选择器：在选中的媒体目录里逐级进入子文件夹，选中当前目录回填。
 */
defineProps<{ folder: ReturnType<typeof useCourseFolder> }>();
</script>

<template>
  <AppModal :open="folder.pickerOpen" title="选择文件夹" width="560px" @close="folder.closePicker()">
    <div class="mc-col">
      <div class="mc-row mc-mono picker__path">
        <button class="mc-btn mc-btn--sm" type="button" :disabled="folder.pickerPath === ''" @click="folder.pickerUp()">
          ↑ 上一级
        </button>
        <span class="mc-truncate">/{{ folder.pickerPath }}</span>
      </div>
      <div v-if="folder.pickerLoading" class="mc-muted">加载中…</div>
      <ul v-else-if="folder.pickerDirs.length > 0" class="picker__list">
        <li v-for="dir in folder.pickerDirs" :key="dir">
          <button class="picker__dir" type="button" @click="folder.pickerEnter(dir)">
            <Icon name="folder" :size="14" /> {{ dir }}
          </button>
        </li>
      </ul>
      <p v-else class="mc-muted">该目录下没有子文件夹，可以直接选当前目录。</p>
    </div>
    <template #footer>
      <button class="mc-btn" type="button" @click="folder.closePicker()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" @click="folder.pickerPick()">选择当前目录</button>
    </template>
  </AppModal>
</template>

<style scoped>
.picker__path {
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2);
  background: var(--mc-bg-sunken);
  border-radius: var(--mc-radius-sm);
  min-width: 0;
}

.picker__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.picker__dir {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-sm);
  cursor: pointer;
  color: var(--mc-text);
}

.picker__dir:hover {
  background: var(--mc-bg-sunken);
}
</style>
