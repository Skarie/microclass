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
  <TransitionGroup tag="div" name="toast" class="toast-host" role="status" aria-live="polite">
    <div v-for="t in toast.items" :key="t.id" class="toast" :class="`toast--${t.type}`">
      <span class="toast__icon" :class="`toast__icon--${t.type}`" aria-hidden="true">
        <Icon :name="iconNames[t.type] ?? 'info'" :size="16" />
      </span>
      <div class="toast__body">
        <p class="toast__message">{{ t.message }}</p>
        <p v-if="t.detail" class="toast__detail">{{ t.detail }}</p>
      </div>
      <button class="toast__close" type="button" aria-label="关闭提示" @click="toast.remove(t.id)">
        <Icon name="close" :size="14" />
      </button>
    </div>
  </TransitionGroup>
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
  width: min(380px, calc(100vw - var(--mc-space-8)));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--mc-space-3);
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
  pointer-events: auto;
}

/* 失败只在底色上留一丝红（8%），边框与文字仍是中性 */
.toast--error {
  background: color-mix(in srgb, var(--mc-danger) 8%, var(--mc-bg-elevated));
}

.toast__icon {
  display: inline-flex;
  flex: none;
  margin-top: 1px;
}

.toast__icon--success {
  color: var(--mc-success);
}

.toast__icon--error {
  color: var(--mc-danger);
}

.toast__icon--warning {
  color: var(--mc-warning);
}

.toast__icon--info {
  color: var(--mc-info);
}

.toast__body {
  flex: 1;
  min-width: 0;
}

.toast__message {
  margin: 0;
  font-size: var(--mc-text-sm);
  line-height: var(--mc-leading-snug);
  color: var(--mc-text);
  overflow-wrap: anywhere;
}

.toast__detail {
  margin: var(--mc-space-1) 0 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
}

.toast__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-xs);
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
  transition: var(--mc-transition-colors);
}

.toast__close:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.toast__close:focus-visible {
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 180ms var(--mc-ease),
    transform 180ms var(--mc-ease);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.toast-move {
  transition: transform 180ms var(--mc-ease);
}

@media (max-width: 900px) {
  .toast-host {
    right: var(--mc-space-4);
    bottom: calc(var(--mc-space-12) + var(--mc-space-6) + env(safe-area-inset-bottom));
    left: var(--mc-space-4);
    align-items: center;
    width: auto;
  }

  .toast {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition: none;
  }
}
</style>
