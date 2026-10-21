<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 绑定状态由 useCourseFolder 持有，弹窗就地编辑（与 CoursesFilterBar 一致） */
import AppModal from '@/components/AppModal.vue';
import type { MediaRoot } from '@/api/types';
import type { useCourseFolder } from '@/composables/use-course-folder';

/**
 * 绑定 / 更换课程文件夹：选媒体目录 + 子文件夹（可用「浏览…」逐级选择）。
 * 一个文件夹只能绑定一门课程；保存后不会立刻导入，需再点「扫描」。
 */
defineProps<{
  folder: ReturnType<typeof useCourseFolder>;
  roots: MediaRoot[];
}>();
</script>

<template>
  <AppModal :open="folder.bindOpen" title="选择课程文件夹" width="620px" @close="folder.closeBind()">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">媒体目录</span>
        <select v-model="folder.bindRootId" class="mc-select" aria-label="媒体目录">
          <option v-for="r in roots" :key="r.id" :value="r.id" :disabled="r.available === false">
            {{ r.name }}（{{ r.path }}）{{ r.available === false ? '· 不可访问' : '' }}
          </option>
        </select>
      </label>

      <label class="mc-field">
        <span class="mc-label">子文件夹（可留空 = 用整个目录）</span>
        <div class="mc-row bind__path">
          <input
            v-model.trim="folder.bindPath"
            class="mc-input"
            type="text"
            placeholder="例如：Java 程序设计"
            aria-label="子文件夹"
          />
          <button class="mc-btn mc-btn--sm" type="button" @click="folder.openPicker()">浏览…</button>
        </div>
      </label>

      <p class="mc-hint">
        一个文件夹只能绑定一门课程；文件夹里的子文件夹会变成章节。绑定不会立刻导入课时，点「扫描」才会。
      </p>

      <p v-if="roots.length === 0" class="mc-hint hint--warn">
        还没有可用的媒体目录。请先在「课时管理 → 媒体目录」里添加宿主机文件夹（Docker 版需先挂载进容器）。
      </p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="folder.closeBind()">取消</button>
      <button
        class="mc-btn mc-btn--primary"
        type="button"
        :disabled="folder.binding || roots.length === 0"
        @click="folder.saveBind()"
      >
        {{ folder.binding ? '保存中…' : '保存并扫描' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.bind__path {
  gap: var(--mc-space-2);
}

.bind__path .mc-input {
  flex: 1;
}

.hint--warn {
  color: var(--mc-warning-fg);
}
</style>
