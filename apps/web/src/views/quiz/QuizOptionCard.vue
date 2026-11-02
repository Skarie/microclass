<script setup lang="ts">
import RichText from '@/components/RichText.vue';
import type { OptionState } from './quiz-types';

/**
 * 大卡片选项：左侧圆形字母 + 右侧富文本内容。
 * 用隐藏的原生 radio/checkbox 承载可访问性与键盘操作，label 整块可点。
 */
const props = withDefaults(
  defineProps<{
    inputType: 'radio' | 'checkbox';
    name: string;
    value: string;
    marker: string;
    text: string;
    checked: boolean;
    disabled: boolean;
    state?: OptionState;
  }>(),
  { state: 'idle' },
);

const emit = defineEmits<{ toggle: [value: string] }>();
</script>

<template>
  <label class="opt" :class="[`opt--${props.state}`, { 'opt--locked': props.disabled }]">
    <input
      class="opt__native"
      :type="props.inputType"
      :name="props.name"
      :value="props.value"
      :checked="props.checked"
      :disabled="props.disabled"
      @change="emit('toggle', props.value)"
    />
    <span class="opt__marker" aria-hidden="true">{{ props.marker }}</span>
    <RichText class="opt__text" inline :text="props.text" />
  </label>
</template>

<style scoped>
.opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  min-height: 56px;
  padding: var(--mc-space-3) var(--mc-space-4);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-md);
  background: var(--mc-bg-elevated);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition),
    box-shadow var(--mc-transition);
}

@media (hover: hover) and (pointer: fine) {
  .opt:not(.opt--locked):hover {
    background: var(--mc-bg-hover);
  }
}

.opt:focus-within {
  outline: 2px solid var(--mc-primary);
  outline-offset: 2px;
}

.opt__native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.opt__marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  transition:
    background var(--mc-transition),
    color var(--mc-transition),
    border-color var(--mc-transition);
}

.opt__text {
  min-width: 0;
  font-size: var(--mc-text-base);
  line-height: var(--mc-leading);
}

.opt--selected {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
}

.opt--selected .opt__marker {
  border-color: var(--mc-primary);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

.opt--correct {
  border-color: var(--mc-success);
  background: var(--mc-success-soft);
}

.opt--correct .opt__marker {
  border-color: var(--mc-success);
  background: var(--mc-success);
  color: var(--mc-text-inverse);
}

.opt--wrong {
  border-color: var(--mc-danger);
  background: var(--mc-danger-soft);
}

.opt--wrong .opt__marker {
  border-color: var(--mc-danger);
  background: var(--mc-danger);
  color: var(--mc-text-inverse);
}

.opt--locked {
  cursor: default;
}

@media (max-width: 1023px) {
  .opt {
    gap: var(--mc-space-2);
    min-height: 48px;
    padding: var(--mc-space-3);
  }
}
</style>
