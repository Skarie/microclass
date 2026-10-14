<script setup lang="ts">
import { useToastStore } from '@/stores/toast';
import Icon from './Icon.vue';
import type { IconName } from './icons';

const toast = useToastStore();
const iconNames: Record<string, IconName> = {
  success: 'check-circle',
  error: 'x-circle',
  warning: 'alert',
  info: 'info',
};
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <div v-for="t in toast.items" :key="t.id" class="toast" :class="`toast--${t.type}`">
      <span class="toast__icon" aria-hidden="true"><Icon :name="iconNames[t.type] ?? 'info'" :size="13" /></span>
      <div class="toast__body">
        <div class="toast__message">{{ t.message }}</div>
        <div v-if="t.detail" class="toast__detail">{{ t.detail }}</div>
      </div>
      <button class="toast__close" type="button" aria-label="关闭提示" @click="toast.remove(t.id)">
        <Icon name="close" :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--mc-space-5);
  bottom: var(--mc-space-5);
  z-index: var(--mc-z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  max-width: 380px;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  background: var(--mc-bg-elevated);
  border: 1px solid var(--mc-border);
  border-left-width: 3px;
  border-radius: var(--mc-radius);
  box-shadow: var(--mc-shadow-md);
  animation: toast-in 180ms ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.toast--success {
  border-left-color: var(--mc-success);
}

.toast--error {
  border-left-color: var(--mc-danger);
}

.toast--warning {
  border-left-color: var(--mc-warning);
}

.toast--info {
  border-left-color: var(--mc-info);
}

.toast__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: var(--mc-text-xs);
  font-weight: 700;
  color: var(--mc-text-inverse);
  background: var(--mc-primary);
  flex: none;
  margin-top: 2px;
}

.toast--success .toast__icon {
  background: var(--mc-success);
}

.toast--error .toast__icon {
  background: var(--mc-danger);
}

.toast--warning .toast__icon {
  background: var(--mc-warning);
}

.toast__body {
  flex: 1;
}

.toast__message {
  font-size: var(--mc-text-sm);
}

.toast__detail {
  margin-top: 2px;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.toast__close {
  border: none;
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
</style>
