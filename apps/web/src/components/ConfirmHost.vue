<script setup lang="ts">
/**
 * 全局确认弹窗的宿主：只渲染 use-confirm 的状态。
 * 标题 16/600、正文 14/1.65；取消在左、确认在右，危险操作确认键是 danger 实底。
 */
import AppModal from '@/components/AppModal.vue';
import { confirmState, settleConfirm } from '@/composables/use-confirm';
</script>

<template>
  <AppModal :open="confirmState.open" :title="confirmState.title" width="440px" @close="settleConfirm(false)">
    <div class="confirm">
      <p class="confirm__message">{{ confirmState.message }}</p>
      <p v-if="confirmState.detail" class="confirm__detail">{{ confirmState.detail }}</p>
    </div>

    <template #footer>
      <button class="mc-btn" type="button" @click="settleConfirm(false)">{{ confirmState.cancelText }}</button>
      <button
        class="mc-btn"
        :class="confirmState.danger ? 'confirm__danger' : 'mc-btn--primary'"
        type="button"
        @click="settleConfirm(true)"
      >
        {{ confirmState.confirmText }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.confirm__message {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading);
  color: var(--mc-text-secondary);
  overflow-wrap: anywhere;
}

.confirm__detail {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
}

.confirm__danger {
  border-color: var(--mc-danger);
  background: var(--mc-danger);
  color: var(--mc-text-inverse);
}

.confirm__danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--mc-danger) 86%, var(--mc-player-bg));
  background: color-mix(in srgb, var(--mc-danger) 86%, var(--mc-player-bg));
}

.confirm__danger:focus-visible {
  outline: none;
  box-shadow: var(--mc-focus-ring-danger);
}
</style>
