<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';
import type { OptionState } from './quiz-types';

/**
 * 泛雅式选项行：48px 高、8px 圆角、白底细边；字母/「对错」圆标 24px。
 * 选中 = 左侧 3px 主色内阴影 + 浅主色底 + 主色实心圆标；多选把圆标换成方形。
 * 解析态正确行绿底打勾、错误行红底打叉。
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
  <label
    class="opt"
    :class="[`opt--${props.state}`, { 'opt--locked': props.disabled, 'opt--multi': props.inputType === 'checkbox' }]"
  >
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
    <Icon v-if="props.state === 'correct'" class="opt__verdict" name="check-circle" :size="18" />
    <Icon v-else-if="props.state === 'wrong'" class="opt__verdict" name="x-circle" :size="18" />
  </label>
</template>

<style scoped>
.opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  min-height: 48px;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xs);
  background: var(--mc-bg-elevated);
  cursor: pointer;
  transition:
    background var(--mc-transition),
    border-color var(--mc-transition),
    box-shadow var(--mc-transition);
}

@media (hover: hover) and (pointer: fine) {
  .opt:not(.opt--locked):hover {
    border-color: var(--mc-border-strong);
    background: var(--mc-bg-hover);
  }
}

.opt:has(.opt__native:focus-visible) {
  outline: 2px solid var(--mc-primary);
  outline-offset: 1px;
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
  flex: none;
  align-self: center;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-bg-sunken);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  transition:
    background var(--mc-transition),
    color var(--mc-transition);
}

.opt--multi .opt__marker {
  border-radius: var(--mc-radius-xs);
}

.opt__text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  font-size: var(--mc-quiz-font-size);
  line-height: var(--mc-leading-snug);
  line-height: var(--mc-leading);
}

.opt__verdict {
  flex: none;
  color: var(--mc-text-muted);
}

.opt--selected {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  box-shadow: inset 3px 0 0 var(--mc-primary);
}

.opt--selected .opt__marker {
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
}

.opt--correct {
  border-color: var(--mc-success);
  background: var(--mc-success-soft);
  box-shadow: inset 3px 0 0 var(--mc-success);
}

.opt--correct .opt__marker {
  background: var(--mc-success);
  color: var(--mc-text-inverse);
}

.opt--correct .opt__verdict {
  color: var(--mc-success-fg);
}

.opt--wrong {
  border-color: var(--mc-danger);
  background: var(--mc-danger-soft);
  box-shadow: inset 3px 0 0 var(--mc-danger);
}

.opt--wrong .opt__marker {
  background: var(--mc-danger);
  color: var(--mc-text-inverse);
}

.opt--wrong .opt__verdict {
  color: var(--mc-danger-fg);
}

.opt--locked {
  cursor: default;
}
</style>
