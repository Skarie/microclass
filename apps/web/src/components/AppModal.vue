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

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      requestAnimationFrame(() => panel.value?.focus());
    }
  },
);

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
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
</style>
