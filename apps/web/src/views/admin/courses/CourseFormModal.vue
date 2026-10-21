<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 表单对象由 use-course-crud 持有，弹窗就地编辑（与 BankFormDialog 一致） */
import AppModal from '@/components/AppModal.vue';
import type { Category } from '@/api/types';
import type { useCourseCrud } from '@/composables/use-course-crud';

/**
 * 新建 / 编辑课程弹窗。表单状态与保存动作在 use-course-crud，
 * 只读的 `editingId === null` 决定标题与按钮文案。
 */
defineProps<{ crud: ReturnType<typeof useCourseCrud>; categories: Category[] }>();
</script>

<template>
  <AppModal :open="crud.formOpen" :title="crud.editingId === null ? '新建课程' : '编辑课程'" @close="crud.closeForm()">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">课程名称</span>
        <input
          v-model="crud.form.name"
          class="mc-input"
          type="text"
          maxlength="120"
          placeholder="例如：Java 程序设计基础"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label">课程简介</span>
        <textarea
          v-model="crud.form.description"
          class="mc-textarea"
          maxlength="2000"
          placeholder="一句话说明课程内容与适合人群"
        />
      </label>

      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label">所属分类</span>
          <select v-model="crud.form.categoryId" class="mc-select">
            <option value="">未分类</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>

        <label class="mc-field">
          <span class="mc-label">排序</span>
          <input v-model.number="crud.form.sort" class="mc-input" type="number" min="0" />
        </label>
      </div>

      <label class="mc-checkbox">
        <input v-model="crud.form.published" type="checkbox" />
        立即发布（不勾选则保存为草稿，仅教师可见）
      </label>

      <p v-if="crud.editingId === null" class="mc-hint">
        创建后会直接进入该课程的课时管理，在那里选择视频文件夹并点「扫描」即可导入课时。
      </p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="crud.closeForm()">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="crud.saving" @click="crud.save()">
        {{ crud.saving ? '保存中…' : crud.editingId === null ? '创建并进入课程' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: var(--mc-space-4);
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
