<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';

/**
 * 移动端答题卡底部抽屉：遮罩 + 可关闭，Esc / 点遮罩都关闭。
 * 内容由调用方以插槽传入（与桌面右侧面板共用同一份答题卡组件）。
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
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
    <div v-if="open" class="qdrawer">
      <div class="qdrawer__backdrop" @click="emit('close')" />
      <section class="qdrawer__panel" role="dialog" aria-modal="true" aria-label="答题卡">
        <div class="qdrawer__handle" aria-hidden="true" />
        <div class="qdrawer__body">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.qdrawer {
  position: fixed;
  inset: 0;
  z-index: var(--mc-z-modal);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.qdrawer__backdrop {
  position: absolute;
  inset: 0;
  background: var(--mc-overlay);
}

.qdrawer__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: 84vh;
  padding: var(--mc-space-2) var(--mc-space-4) var(--mc-space-4);
  border-radius: var(--mc-radius-2xl) var(--mc-radius-2xl) 0 0;
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

.qdrawer__handle {
  width: 40px;
  height: 4px;
  margin: var(--mc-space-2) auto var(--mc-space-3);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-border-strong);
}

.qdrawer__body {
  overflow-y: auto;
}
</style>
