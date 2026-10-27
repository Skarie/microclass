<script setup lang="ts">
/**
 * 题库表单弹窗：名称、册次、章节、关联课时。
 * 表单对象由父组件持有，这里通过 v-model 就地编辑，保存交给父组件。
 */
/* eslint-disable vue/no-mutating-props */
// 表单对象由父组件持有，子组件就地编辑嵌套字段（v-model），不改引用
import { computed } from 'vue';
import AppModal from '@/components/AppModal.vue';

interface LessonOption {
  id: number;
  title: string;
}

const props = defineProps<{
  open: boolean;
  editingId: number | null;
  saving: boolean;
  form: { name: string; book: string; section: string; lessonId: number | '' };
  lessonOptions: LessonOption[];
  bookOptions: string[];
  sectionOptions: string[];
  catalogCourseId: number | null;
}>();

const emit = defineEmits<{ close: []; save: [] }>();

/** 正在编辑的册次/章节可能不在候选里（刚导入的新值），也补进 datalist 方便复用 */
const bookCandidates = computed(() => {
  const values = props.form.book.trim() === '' ? props.bookOptions : [props.form.book.trim(), ...props.bookOptions];
  return [...new Set(values)].slice(0, 30);
});
const sectionCandidates = computed(() => {
  const values =
    props.form.section.trim() === '' ? props.sectionOptions : [props.form.section.trim(), ...props.sectionOptions];
  return [...new Set(values)].slice(0, 30);
});
</script>

<template>
  <AppModal :open="open" :title="editingId === null ? '新建题库' : '编辑题库'" @close="emit('close')">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">题库名称</span>
        <input v-model="form.name" class="mc-input" type="text" maxlength="200" placeholder="例如：第 01 讲 课后练习" />
      </label>

      <div class="form-grid">
        <label class="mc-field">
          <span class="mc-label">册次</span>
          <input
            v-model="form.book"
            class="mc-input"
            type="text"
            maxlength="80"
            list="bank-book-options"
            placeholder="例如：必修1"
          />
          <datalist id="bank-book-options">
            <option v-for="book in bookCandidates" :key="book" :value="book" />
          </datalist>
          <span class="mc-hint">留空显示为「未归类册次」。</span>
        </label>

        <label class="mc-field">
          <span class="mc-label">章节</span>
          <input
            v-model="form.section"
            class="mc-input"
            type="text"
            maxlength="120"
            list="bank-section-options"
            placeholder="例如：第一章 集合"
          />
          <datalist id="bank-section-options">
            <option v-for="section in sectionCandidates" :key="section" :value="section" />
          </datalist>
          <span class="mc-hint">留空时，关联课时会自动带出课时章节；也可以手动填写。</span>
        </label>
      </div>

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

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--mc-space-3);
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
