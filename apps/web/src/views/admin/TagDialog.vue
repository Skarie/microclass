<script setup lang="ts">
/**
 * 新建 / 重命名标签（题库页「标签」视图用）。
 *
 * 名称 1~40 字，重名（大小写、首尾空格归一后）服务端返回 409；
 * 备注可选，用来写「这个标签什么时候打」。
 */
import AppModal from '@/components/AppModal.vue';

const name = defineModel<string>('name', { required: true });
const note = defineModel<string>('note', { required: true });

const props = defineProps<{
  open: boolean;
  /** null = 新建，数字 = 编辑该标签 */
  editingId: number | null;
  saving: boolean;
}>();

const emit = defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <AppModal
    :open="open"
    :title="props.editingId === null ? '新建标签' : '重命名标签'"
    :description="props.editingId === null ? '标签用于教研标记：易错、高考真题、自编、需重录等。' : ''"
    width="520px"
    @close="emit('close')"
  >
    <div class="mc-col">
      <label class="mc-field">
        <span class="mc-label mc-label--required">标签名</span>
        <input
          v-model="name"
          class="mc-input"
          type="text"
          maxlength="40"
          placeholder="例如：易错 / 高考真题 / 需重录"
        />
        <span class="mc-hint">最多 40 字；同名标签只允许一个（大小写、首尾空格不敏感）。</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">备注</span>
        <textarea v-model="note" class="mc-textarea" maxlength="200" placeholder="可选：这个标签什么时候打、给谁看" />
        <span class="mc-hint">最多 200 字，只在管理端可见。</span>
      </label>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="emit('close')">取消</button>
      <button class="mc-btn mc-btn--primary" type="button" :disabled="saving" @click="emit('save')">
        {{ saving ? '保存中…' : props.editingId === null ? '新建标签' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>
