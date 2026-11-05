<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/**
 * 泛雅式底部操作条：不再是一整块大卡片。
 * 桌面 = 左侧快捷键提示 + 标记疑问，右侧「上一题 / 下一题」；
 * 移动端 = 固定底栏「上一题 / 答题卡 / 下一题」。
 */
defineProps<{
  index: number;
  total: number;
  marked: boolean;
  revealed: boolean;
  /** 错题本不需要「标记疑问」 */
  showMark?: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  mark: [];
  card: [];
}>();
</script>

<template>
  <nav class="bar" aria-label="答题操作">
    <span class="bar__hint">
      <span class="bar__key">← →</span><span>切题</span> <span class="bar__key">A/B/C/D</span><span>选择</span>
    </span>

    <button
      v-if="!revealed && showMark !== false"
      class="bar__mark"
      :class="{ 'bar__mark--on': marked }"
      type="button"
      :aria-pressed="marked"
      @click="emit('mark')"
    >
      <Icon name="helpCircle" :size="14" />
      {{ marked ? '已标记' : '标记疑问' }}
    </button>

    <span class="mc-spacer" />

    <button class="mc-btn bar__btn bar__prev" type="button" :disabled="index <= 0" @click="emit('prev')">
      <Icon name="chevron-left" :size="16" />
      上一题
    </button>

    <button class="mc-btn bar__btn bar__card" type="button" @click="emit('card')">
      <Icon name="grid" :size="16" />
      答题卡
    </button>

    <button
      class="mc-btn mc-btn--primary bar__btn bar__next"
      type="button"
      :disabled="index >= total - 1"
      @click="emit('next')"
    >
      下一题
      <Icon name="chevron-right" :size="16" />
    </button>
  </nav>
</template>

<style scoped>
.bar {
  position: sticky;
  bottom: var(--mc-space-4);
  z-index: var(--mc-z-sticky);
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: var(--mc-space-2) 0;
}

.bar__hint {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--mc-space-1) var(--mc-space-2);
  color: var(--mc-text-muted);
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.bar__key {
  padding: 1px var(--mc-space-1);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font-family: var(--mc-font-mono);
  font-size: var(--mc-text-xs);
}

.bar__sep {
  margin: 0 var(--mc-space-1);
}

.bar__mark {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  height: 28px;
  padding: 0 var(--mc-space-2);
  border: 0;
  border-radius: var(--mc-radius-xs);
  background: transparent;
  color: var(--mc-text-muted);
  font: inherit;
  font-size: var(--mc-text-xs);
  cursor: pointer;
  white-space: nowrap;
}

.bar__mark:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text-secondary);
}

.bar__mark--on {
  /* 标记疑问：accent 落点之二 */
  background: var(--mc-accent-soft);
  color: var(--mc-accent-fg);
}

.bar__btn {
  min-height: 36px;
}

.bar__prev {
  order: 1;
}

.bar__card {
  display: none;
  order: 2;
}

.bar__next {
  order: 3;
}

@media (max-width: 1023px) {
  .bar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--mc-space-2);
    padding: var(--mc-space-2) var(--mc-space-4) calc(var(--mc-space-2) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--mc-border);
    background: var(--mc-bg-elevated);
  }

  .bar__hint,
  .bar__mark,
  .bar > .mc-spacer {
    display: none;
  }

  .bar__card {
    display: inline-flex;
  }

  .bar__btn {
    justify-content: center;
    min-height: 44px;
    padding: 0 var(--mc-space-2);
  }
}
</style>

@media (max-width: 1023px) { /* 底部固定条按钮按移动端触控目标放大 */ .bar__btn { min-height: 44px; } }
