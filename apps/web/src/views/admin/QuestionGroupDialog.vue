<script setup lang="ts">
/**
 * 新建 / 重命名题组（题库页「题组」视图用）。
 *
 * 标题与备注都是受控字段：新建时清空、重命名时回填，提交动作在 use-question-groups。
 * 提示写清「一个题组 = 同一考点的一道母题 + 若干变式」，避免老师把它当文件夹用。
 */
import AppModal from '@/components/AppModal.vue';

const title = defineModel<string>('title', { required: true });
const note = defineModel<string>('note', { required: true });

const props = defineProps<{
  open: boolean;
  /** null = 新建，数字 = 编辑该题组 */
  editingId: number | null;
  saving: boolean;
}>();

const emit = defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <AppModal
    :open="open"
    :title="props.editingId === null ? '新建题组' : '重命名题组'"
    :description="props.editingId === null ? '一个题组 = 同一考点的一道母题 + 若干道变式。' : ''"
    width="560px"
    @close="emit('close')"
  >
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">题组标题</span>
        <input
          v-model="title"
          class="mc-input"
          type="text"
          maxlength="100"
          placeholder="例如：一次函数图像 · 母题与三种变式"
        />
        <span class="mc-hint">最多 100 字，建议写清「考点 + 变式主题」，组卷时一眼能找到。</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">备注</span>
        <textarea
          v-model="note"
          class="mc-textarea"
          maxlength="2000"
          placeholder="可选：这组题考什么、变式之间差在哪、适合什么层次的学生"
        />
        <span class="mc-hint">最多 2000 字；备注只在管理端可见。</span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('save')">
        {{ saving ? '保存中…' : props.editingId === null ? '新建题组' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>
