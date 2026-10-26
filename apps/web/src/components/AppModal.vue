<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 通用弹窗：受控显示、Esc 关闭、点击遮罩关闭、
 * 打开时锁定 body 滚动并把焦点移到弹窗内（基础可访问性）。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    width?: string;
    closeOnBackdrop?: boolean;
  }>(),
  { width: '560px', closeOnBackdrop: true },
);

const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);

/** 打开前的焦点元素：关闭后要还回去，键盘用户才不会"丢焦点" */
let previousFocus: HTMLElement | null = null;
/** 多层弹窗叠加时的滚动锁计数，避免内层关闭就把外层滚动解锁 */
let bodyLockCount = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab 在弹窗内循环，不跑到背后的页面上 */
function trapTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !panel.value) return;
  const nodes = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (nodes.length === 0) {
    e.preventDefault();
    panel.value.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) {
    e.preventDefault();
    panel.value.focus();
    return;
  }
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel.value)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return;
  if (e.key === 'Escape') {
    emit('close');
    return;
  }
  trapTab(e);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      bodyLockCount += 1;
      document.body.style.overflow = 'hidden';
      previousFocus = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => panel.value?.focus());
    } else {
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = '';
      previousFocus?.focus?.();
      previousFocus = null;
    }
  },
);

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  bodyLockCount = 0;
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-root">
        <div class="modal-backdrop" @click="closeOnBackdrop && emit('close')" />
        <div
          ref="panel"
          class="modal-panel mc-card"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          :style="{ width }"
        >
          <header class="mc-card__header">
            <span class="mc-card__title">{{ title }}</span>
            <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" aria-label="关闭" @click="emit('close')">
              ×
            </button>
          </header>
          <div class="mc-card__body modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="mc-card__footer modal-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-root {
  position: fixed;
  inset: 0;
  z-index: var(--mc-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--mc-space-5);
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: var(--mc-overlay-strong);
  backdrop-filter: blur(2px);
}

.modal-panel {
  position: relative;
  max-width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--mc-shadow-lg);
}

.modal-body {
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--mc-space-2);
}

/* 出入场：整体淡入，面板轻微上浮；时长沿用全局过渡 token */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--mc-duration) var(--mc-ease-out);
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform var(--mc-duration) var(--mc-ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: translateY(8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-panel,
  .modal-leave-active .modal-panel {
    transition: none;
  }
}
</style>
