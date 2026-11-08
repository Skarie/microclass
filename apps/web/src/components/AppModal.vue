<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

/**
 * 通用弹窗：受控显示、Esc 关闭、点击遮罩关闭、
 * 打开时锁定 body 滚动并把焦点移到弹窗内（基础可访问性）。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 可选副标题：一句话说明这个弹窗要完成什么 */
    description?: string;
    width?: string;
    closeOnBackdrop?: boolean;
  }>(),
  { description: '', width: '560px', closeOnBackdrop: true },
);

const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
const titleId = useId();

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
        :aria-labelledby="titleId"
        tabindex="-1"
        :style="{ width }"
      >
        <header class="mc-card__header modal-head">
          <div class="modal-head__text">
            <span :id="titleId" class="mc-card__title">{{ title }}</span>
            <span v-if="description" class="modal-head__desc">{{ description }}</span>
          </div>
          <button class="modal-close" type="button" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="16" />
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
.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-muted);
  cursor: pointer;
  transition: background var(--mc-transition);
}

.modal-close:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

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
  overflow: hidden;
  border-radius: var(--mc-radius-md);
  box-shadow: var(--mc-shadow-lg);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  overflow-y: auto;
}

.modal-head {
  align-items: flex-start;
}

.modal-head__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.modal-head__desc {
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading);
  color: var(--mc-text-muted);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--mc-space-2);
  /* 底部操作区跟随面板圆角：透明底 + 顶部细线，不再有灰直角露在圆角外 */
  border-radius: 0 0 var(--mc-radius-md) var(--mc-radius-md);
  background: transparent;
  border-top: 1px solid var(--mc-border);
}

@media (max-width: 1023px) {
  .modal-footer :deep(.mc-btn) {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
