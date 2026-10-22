<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 表单对象由 useExamAdminForm 持有，弹窗就地编辑（与 CourseFormModal 一致） */
import AppModal from '@/components/AppModal.vue';
import type { useExamAdminForm } from '@/composables/use-exam-admin-form';

/**
 * 新建 / 编辑考试弹窗：标题、说明、限时、及格线与状态。
 * 只读的 examEditingId === null 决定标题与入口文案。
 */
defineProps<{ form: ReturnType<typeof useExamAdminForm> }>();
</script>

<template>
  <AppModal
    :open="form.examFormOpen"
    :title="form.examEditingId === null ? '新建考试' : '编辑考试'"
    width="600px"
    @close="form.examFormOpen = false"
  >
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">考试标题</span>
        <input
          v-model="form.examForm.title"
          class="mc-input"
          type="text"
          maxlength="200"
          placeholder="例如：期末考试（第 1~4 章）"
        />
      </label>

      <label class="mc-field">
        <span class="mc-label">考试说明</span>
        <textarea
          v-model="form.examForm.description"
          class="mc-textarea"
          maxlength="4000"
          placeholder="告知学员考试范围、注意事项等"
        />
      </label>

      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label">限时（分钟）</span>
          <input v-model.number="form.examForm.durationMinutes" class="mc-input" type="number" min="1" max="600" />
        </label>

        <label class="mc-field">
          <span class="mc-label">及格线（%）</span>
          <input v-model.number="form.examForm.passScore" class="mc-input" type="number" min="0" max="100" />
        </label>
      </div>

      <label class="mc-field">
        <span class="mc-label">状态</span>
        <select v-model="form.examForm.status" class="mc-select">
          <option value="draft">草稿（学员不可见）</option>
          <option value="published">已发布（学员可参加）</option>
        </select>
        <span class="mc-hint">建议先保存为草稿，组卷完成后再发布。</span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="form.examFormOpen = false">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="form.examSaving" @click="form.saveExam">
        {{ form.examSaving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>
