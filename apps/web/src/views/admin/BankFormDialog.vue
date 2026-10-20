<script setup lang="ts">
/**
 * 题库表单弹窗（从 BankAdminView 抽出）：新建/编辑题库名称与关联课时。
 * 表单对象由父组件持有，这里通过 v-model 就地编辑，保存交给父组件。
 */
/* eslint-disable vue/no-mutating-props */
// 表单对象由父组件持有，子组件就地编辑嵌套字段（v-model），不改引用
import AppModal from '@/components/AppModal.vue';

interface LessonOption {
  id: number;
  title: string;
}

defineProps<{
  open: boolean;
  editingId: number | null;
  saving: boolean;
  form: { name: string; lessonId: number | '' };
  lessonOptions: LessonOption[];
  catalogCourseId: number | null;
}>();

const emit = defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <AppModal :open="open" :title="editingId === null ? '新建题库' : '编辑题库'" @close="emit('close')">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">题库名称</span>
        <input v-model="form.name" class="mc-input" type="text" maxlength="200" placeholder="例如：第 01 讲 课后练习" />
      </label>

      <label class="mc-field">
        <span class="mc-label">关联课时</span>
        <select v-model="form.lessonId" class="mc-select">
          <option value="">不关联课时</option>
          <option v-for="lesson in lessonOptions" :key="lesson.id" :value="lesson.id">
            {{ lesson.title }}
          </option>
        </select>
        <span class="mc-hint">
          关联课时后，该题库会作为该课时的课后练习题目来源。列表来自左侧选中的课程
          {{ catalogCourseId === null ? '（请先在左侧选择课程）' : '（含章节分组）' }}。
        </span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('save')">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>
