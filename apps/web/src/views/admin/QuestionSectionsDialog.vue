<script setup lang="ts">
/**
 * 批量设置章节 / 小节（选中题目后从批量操作条打开）。
 *
 * 两个输入都会随请求一起提交：留空 = 清空该字段（把题退回「未分章 / 未分节」），
 * 允许只填一个 —— 另一个留空即被清空。保存动作在 use-question-selection。
 */
import AppModal from '@/components/AppModal.vue';

const chapter = defineModel<string>('chapter', { required: true });
const section = defineModel<string>('section', { required: true });

defineProps<{ open: boolean; saving: boolean; count: number }>();
const emit = defineEmits<{ close: []; save: [] }>();
</script>

<template>
  <AppModal :open="open" title="批量设置章节 / 小节" width="560px" @close="emit('close')">
    <div class="mc-col">
      <p class="mc-muted">将对选中的 {{ count }} 道题生效；留空表示清空该字段。</p>

      <label class="mc-field">
        <span class="mc-label">章节</span>
        <input v-model="chapter" class="mc-input" type="text" maxlength="120" placeholder="例如：第一章 有理数" />
        <span class="mc-hint">留空 = 清空章节，这些题会归到「未分章」分组。</span>
      </label>

      <label class="mc-field">
        <span class="mc-label">小节</span>
        <input v-model="section" class="mc-input" type="text" maxlength="120" placeholder="例如：1.1" />
        <span class="mc-hint">允许只填一个：另一个留空就会被清空。</span>
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
