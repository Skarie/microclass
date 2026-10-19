<script setup lang="ts">
/** 导入结果弹窗（从 BankAdminView 抽出）：成功/失败计数、错误与提醒列表、格式说明 */
import AppModal from '@/components/AppModal.vue';

defineProps<{
  open: boolean;
  result: { inserted: number; errors: string[]; warnings: string[] } | null;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <AppModal :open="open" title="导入结果" width="600px" @close="emit('close')">
    <div v-if="result" class="mc-col">
      <div class="mc-row mc-row--wrap">
        <span class="mc-badge mc-badge--success">成功导入 {{ result.inserted }} 题</span>
        <span class="mc-badge" :class="result.errors.length > 0 ? 'mc-badge--danger' : ''">
          未导入 {{ result.errors.length }} 题
        </span>
      </div>

      <p v-if="result.errors.length === 0" class="mc-hint">全部题目都导入成功。</p>

      <ul v-else class="error-list">
        <li v-for="(msg, i) in result.errors" :key="i" class="error-list__item">{{ msg }}</li>
      </ul>

      <template v-if="result.warnings.length > 0">
        <span class="mc-label">需要注意</span>
        <ul class="error-list error-list--warn">
          <li v-for="(msg, i) in result.warnings" :key="i" class="error-list__item">{{ msg }}</li>
        </ul>
      </template>

      <span class="mc-hint import-help">
        支持 CSV（Excel）、Markdown（.md/.txt）与 Word（.docx）。Markdown / Word 的写法：题型行（如
        <code>### 1. 单选题</code>）→ 题干 → <code>A. 选项</code> → <code>答案：B</code> → <code>解析：…</code>；<strong
          >Word 里的配图会自动导入成题目配图</strong
        >。可先下载模板照着写。
      </span>
    </div>

    <template #footer>
      <button class="mc-btn mc-btn--primary" type="button" @click="emit('close')">知道了</button>
    </template>
  </AppModal>
</template>

<style scoped>
.error-list {
  margin: 0;
  padding: var(--mc-space-3) var(--mc-space-3) var(--mc-space-3) var(--mc-space-6);
  list-style: disc;
  max-height: 260px;
  overflow-y: auto;
  border-radius: var(--mc-radius);
  background: var(--mc-danger-soft);
  color: var(--mc-danger-fg);
  font-size: var(--mc-text-sm);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.error-list__item {
  word-break: break-all;
}

.error-list--warn {
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
}
</style>
