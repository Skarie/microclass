<script setup lang="ts">
import Icon from '@/components/Icon.vue';

/** 底部操作条：上一题 / 标记疑问 / 答题卡 / 下一题；移动端固定并补交卷 */
defineProps<{
  index: number;
  total: number;
  marked: boolean;
  revealed: boolean;
  submitting: boolean;
  unlocked: boolean;
  /** 错题本不需要「标记疑问」与交卷 */
  showMark?: boolean;
  showSubmit?: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  mark: [];
  card: [];
  submit: [];
}>();
</script>

<template>
  <nav class="bar" aria-label="答题操作">
    <button class="mc-btn bar__btn" type="button" :disabled="index <= 0" @click="emit('prev')">
      <Icon name="chevron-left" :size="16" />
      上一题
    </button>

    <button
      v-if="!revealed && showMark !== false"
      class="bar__mark"
      :class="{ 'bar__mark--on': marked }"
      type="button"
      :aria-pressed="marked"
      @click="emit('mark')"
    >
      <Icon name="helpCircle" :size="16" />
      {{ marked ? '已标记' : '标记疑问' }}
    </button>

    <button class="mc-btn bar__btn" type="button" @click="emit('card')">
      <Icon name="grid" :size="16" />
      答题卡
    </button>

    <span class="mc-spacer" />

    <button class="mc-btn bar__btn" type="button" :disabled="index >= total - 1" @click="emit('next')">
      下一题
      <Icon name="chevron-right" :size="16" />
    </button>

    <button
      v-if="!revealed && showSubmit !== false"
      class="mc-btn mc-btn--primary bar__submit"
      type="button"
      :disabled="submitting || !unlocked"
      @click="emit('submit')"
    >
      {{ submitting ? '提交中…' : '交卷' }}
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
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-lg);
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-sm);
}

.bar__btn {
  min-height: 36px;
}

.bar__mark {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 36px;
  padding: 0 var(--mc-space-3);
  border: 1px solid var(--mc-border-strong);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  color: var(--mc-text-secondary);
  font: inherit;
  font-size: var(--mc-text-sm);
  cursor: pointer;
  white-space: nowrap;
}

.bar__mark--on {
  border-color: var(--mc-warning);
  background: var(--mc-warning-soft);
  color: var(--mc-warning-fg);
  font-weight: var(--mc-font-semibold);
}

.bar__submit {
  display: none;
}

@media (max-width: 1023px) {
  .bar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    gap: var(--mc-space-1);
    padding: var(--mc-space-2) var(--mc-space-4) calc(var(--mc-space-2) + env(safe-area-inset-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 0;
    box-shadow: var(--mc-shadow-md);
  }

  .bar__mark {
    display: none;
  }

  .bar__btn {
    min-height: 44px;
    padding: 0 var(--mc-space-2);
  }

  .bar__submit {
    display: inline-flex;
    min-height: 44px;
    padding: 0 var(--mc-space-3);
  }
}
</style>
