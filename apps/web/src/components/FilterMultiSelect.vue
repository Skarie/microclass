<script setup lang="ts">
/**
 * 通用「多选筛选 + 任意/全部」控件（题库筛选条、组卷挑题左栏共用）。
 *
 * 为什么不用 `<select multiple>`：手机上系统多选弹层交互不统一，且看不到已选了什么。
 * 这里做成「下拉加一项 → 变成可删除的 chip → 两个以上时出现 任意/全部 切换」。
 *
 * 受控组件：`modelValue` 是已选的「值」（字符串，数字 id 由调用方转换），
 * `mode` 只在选中项 ≥2 时有意义（any = 命中任意一个，all = 同时包含全部）。
 */
import { computed } from 'vue';
import Icon from './Icon.vue';

export interface FilterOption {
  value: string;
  label: string;
  /** 右侧的计数说明（如「12 题」） */
  hint?: string;
}

const props = withDefaults(
  defineProps<{
    label: string;
    options: FilterOption[];
    modelValue: string[];
    mode?: 'any' | 'all';
    /** 下拉里的占位文案 */
    placeholder?: string;
    /** 多项时的模式切换是否显示 */
    threshold?: number;
  }>(),
  { mode: 'any', placeholder: '添加筛选…', threshold: 2 },
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
  'update:mode': [value: 'any' | 'all'];
}>();

const selectedSet = computed(() => new Set(props.modelValue));
const available = computed(() => props.options.filter((option) => !selectedSet.value.has(option.value)));
const chips = computed(() =>
  props.modelValue.map((value) => ({
    value,
    label: props.options.find((option) => option.value === value)?.label ?? value,
  })),
);

function onPick(event: Event): void {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  select.value = '';
  if (value === '') return;
  emit('update:modelValue', [...props.modelValue, value]);
}

function remove(value: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== value),
  );
}
</script>

<template>
  <div class="fms">
    <span class="fms__label">{{ label }}</span>
    <select class="mc-select fms__select" :aria-label="`${label}筛选`" :value="''" @change="onPick">
      <option value="">{{ available.length === 0 ? '没有更多可选' : placeholder }}</option>
      <option v-for="option in available" :key="option.value" :value="option.value">
        {{ option.label }}{{ option.hint ? `（${option.hint}）` : '' }}
      </option>
    </select>

    <span v-if="chips.length > 0" class="fms__chips">
      <span v-for="chip in chips" :key="chip.value" class="fms__chip">
        {{ chip.label }}
        <button
          class="fms__chipbtn"
          type="button"
          :aria-label="`移除${label}筛选 ${chip.label}`"
          @click="remove(chip.value)"
        >
          <Icon name="close" :size="12" />
        </button>
      </span>
    </span>

    <span v-if="modelValue.length >= threshold" class="fms__mode" role="group" :aria-label="`${label}匹配方式`">
      <button
        class="fms__modebtn"
        :class="{ 'fms__modebtn--on': mode === 'any' }"
        type="button"
        :aria-pressed="mode === 'any'"
        @click="emit('update:mode', 'any')"
      >
        任意一个
      </button>
      <button
        class="fms__modebtn"
        :class="{ 'fms__modebtn--on': mode === 'all' }"
        type="button"
        :aria-pressed="mode === 'all'"
        @click="emit('update:mode', 'all')"
      >
        同时包含
      </button>
    </span>
  </div>
</template>

<style scoped>
.fms {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
  max-width: 100%;
}

.fms__label {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  white-space: nowrap;
}

.fms__select {
  min-width: 120px;
  max-width: 200px;
}

.fms__chips {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  flex-wrap: wrap;
}

.fms__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 1px solid var(--mc-primary-border);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
}

.fms__chipbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 桌面标准触控下限 24×24；移动端由下面 44px 兜底 */
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.fms__mode {
  display: inline-flex;
  gap: var(--mc-space-1);
}

.fms__modebtn {
  min-height: 28px;
  padding: 0 var(--mc-space-2);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-pill);
  background: transparent;
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-xs);
  cursor: pointer;
}

.fms__modebtn--on {
  border-color: var(--mc-primary);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
}

@media (max-width: 900px) {
  .fms__select {
    flex: 1 1 140px;
    max-width: none;
  }

  .fms__modebtn,
  .fms__chipbtn {
    min-height: var(--mc-touch-target-mobile);
    min-width: var(--mc-touch-target-mobile);
  }
}
</style>
