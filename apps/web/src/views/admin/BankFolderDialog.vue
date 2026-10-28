<script setup lang="ts">
import AppModal from '@/components/AppModal.vue';

/**
 * 新建 / 重命名文件夹的轻量弹窗。
 * 名称由父组件持有（v-model:name），保存与 409 提示在 catalog 组合式函数里做。
 */
defineProps<{
  open: boolean;
  title: string;
  mode: 'create' | 'rename';
  parentName: string;
  saving: boolean;
}>();

const name = defineModel<string>('name', { required: true });
const emit = defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <AppModal :open="open" :title="title" width="440px" @close="emit('close')">
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">文件夹名称</span>
        <input
          v-model="name"
          class="mc-input"
          type="text"
          maxlength="80"
          placeholder="例如：第一章"
          @keyup.enter="emit('save')"
        />
        <span v-if="mode === 'create'" class="mc-hint">将创建在「{{ parentName }}」下；同级重名会被拒绝。</span>
        <span v-else class="mc-hint">重命名只改名称，文件夹里的题库与子文件夹不受影响。</span>
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
