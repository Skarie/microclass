<script setup lang="ts">
import { computed } from 'vue';
import { fillPlaceholder, joinBlankAnswers, splitBlankAnswers } from '@/utils/quiz';

/**
 * 填空题作答：单空保持原来的一个输入框；多空按空位渲染多个输入框，
 * 提交时按顺序用「；」拼接（与题库导入/后端判分编码一致）。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    blanks?: number;
    disabled?: boolean;
  }>(),
  { blanks: 1, disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const fields = computed(() => splitBlankAnswers(props.modelValue, Math.max(1, props.blanks)));

function onInput(index: number, value: string): void {
  const next = [...fields.value];
  next[index] = value;
  emit('update:modelValue', joinBlankAnswers(next));
}
</script>

<template>
  <div v-if="fields.length <= 1" class="fill">
    <input
      class="mc-input fill__input"
      :value="props.modelValue"
      :placeholder="fillPlaceholder(props.blanks)"
      :disabled="props.disabled"
      :aria-label="'填空题答案'"
      @input="onInput(0, ($event.target as HTMLInputElement).value)"
    />
  </div>

  <div v-else class="fill fill--multi">
    <div class="fill__grid">
      <label v-for="(part, i) in fields" :key="i" class="fill__item">
        <span class="fill__no">第 {{ i + 1 }} 空</span>
        <input
          class="mc-input"
          :value="part"
          :disabled="props.disabled"
          :aria-label="`第 ${i + 1} 空答案`"
          :placeholder="`填写第 ${i + 1} 空`"
          @input="onInput(i, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
    <p class="mc-hint fill__hint">共 {{ fields.length }} 个空，按顺序自动用「；」拼接。</p>
  </div>
</template>

<style scoped>
.fill {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.fill__input {
  max-width: 460px;
}

.fill__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--mc-space-3);
}

.fill__item {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
}

.fill__no {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.fill__hint {
  margin: 0;
}
</style>
