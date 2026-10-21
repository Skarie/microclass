<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 改绑表单由 use-lesson-actions 持有，弹窗就地编辑 */
import AppModal from '@/components/AppModal.vue';
import type { Course } from '@/api/types';
import type { useLessonActions } from '@/composables/use-lesson-actions';

/**
 * 批量改绑弹窗：目标课程（可移出到未归类）+ 可选统一章节名。
 * 已选数量与提交动作都在 use-lesson-actions。
 */
defineProps<{ actions: ReturnType<typeof useLessonActions>; courses: Course[] }>();
</script>

<template>
  <AppModal :open="actions.assignOpen" title="批量改绑到课程" width="560px" @close="actions.closeAssign()">
    <div class="mc-col">
      <p class="mc-hint">已选 {{ actions.assignIds.length }} 个课时。改绑只改归属，课时、进度、刷题记录都跟随保留。</p>

      <label class="mc-field">
        <span class="mc-label mc-label--required">目标课程</span>
        <select v-model="actions.assignForm.courseId" class="mc-select" aria-label="目标课程">
          <option value="">请选择课程</option>
          <option v-if="actions.assignScope === 'all'" value="orphan">移出课程（回到未归类）</option>
          <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>

      <label class="mc-field">
        <span class="mc-label">统一章节名（可选）</span>
        <input
          v-model.trim="actions.assignForm.groupName"
          class="mc-input"
          type="text"
          maxlength="120"
          placeholder="留空则保留各自原章节，例如：第一章 Java 基础"
        />
        <span class="mc-hint">填写后这些课时的章节会统一改成该名称。</span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="actions.closeAssign()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="actions.assigning" @click="actions.runAssign()">
        {{ actions.assigning ? '处理中…' : '确认改绑' }}
      </button>
    </template>
  </AppModal>
</template>
