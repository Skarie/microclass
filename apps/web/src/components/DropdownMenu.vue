<script setup lang="ts">
/**
 * 下拉菜单：把"低频次要操作"收进「更多」里，让页面上只留主操作。
 *
 * 背景：真机题库页详情区曾有 8 个同权重按钮并排（建考试/清理重复/导出 CSV/Markdown/
 * Word 含答案/Word 不含答案/导入/新建），主次不分。
 *
 * 可访问性：触发按钮 `aria-haspopup="menu"`、菜单 `role="menu"`、项 `role="menuitem"`；
 * 支持 ↑↓ 移动、Enter/Space 选中、Esc 关闭、点外部关闭、关闭后焦点回到触发按钮。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';
import type { IconName } from './icons';

export interface MenuItem {
  key: string;
  label: string;
  icon?: IconName;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: MenuItem[];
    label?: string;
    /** 触发按钮外观 */
    variant?: 'default' | 'ghost' | 'soft';
    align?: 'left' | 'right';
    disabled?: boolean;
    /** 前置图标；传 null 表示不显示（默认 list，容易和内容图标混淆） */
    icon?: IconName | null;
    /** 是否显示下拉箭头 */
    showCaret?: boolean;
    /** 无文字时给按钮一个可访问名称 */
    ariaLabel?: string; // eslint 要求可选 prop 给默认值：默认取 label
  }>(),
  { label: '更多', variant: 'default', align: 'right', disabled: false, icon: 'list', showCaret: true, ariaLabel: '' },
);

const emit = defineEmits<{ select: [key: string] }>();

const open = ref(false);
const activeIndex = ref(-1);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
}

async function focusItem(index: number): Promise<void> {
  const enabled = props.items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (enabled.length === 0) return;
  const pos = Math.max(
    0,
    enabled.findIndex((i) => i >= index) >= 0 ? enabled.findIndex((i) => i >= index) : enabled.length - 1,
  );
  activeIndex.value = enabled[pos] ?? enabled[0]!;
  await nextTick();
  (menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')[pos] ?? null)?.focus();
}

function move(delta: number): void {
  const enabled = props.items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (enabled.length === 0) return;
  const current = enabled.indexOf(activeIndex.value);
  const next = enabled[(current + delta + enabled.length) % enabled.length];
  void focusItem(next ?? 0);
}

function choose(item: MenuItem): void {
  if (item.disabled) return;
  open.value = false;
  emit('select', item.key);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) {
    e.preventDefault();
    open.value = false;
    trigger.value?.focus();
    return;
  }
  if (!open.value && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    open.value = true;
    void focusItem(0);
    return;
  }
  if (!open.value) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    void focusItem(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    void focusItem(props.items.length - 1);
  }
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return;
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

watch(open, (v) => {
  if (!v) activeIndex.value = -1;
});

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="root" class="dd" @keydown="onKeydown">
    <button
      ref="trigger"
      class="mc-btn mc-btn--sm dd__trigger"
      :class="{ 'mc-btn--ghost': variant === 'ghost', 'mc-btn--soft': variant === 'soft' }"
      type="button"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-label="ariaLabel || label"
      :aria-expanded="open"
      @click="toggle"
    >
      <slot name="trigger">
        <Icon v-if="icon" :name="icon" :size="15" />
        <span v-if="label">{{ label }}</span>
        <Icon v-if="showCaret" name="chevron-down" :size="14" class="dd__caret" />
      </slot>
    </button>

    <div v-if="open" ref="menu" class="dd__menu" :class="`dd__menu--${align}`" role="menu" tabindex="-1">
      <button
        v-for="item in items"
        :key="item.key"
        class="dd__item"
        :class="{ 'dd__item--danger': item.danger }"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        :title="item.hint"
        @click="choose(item)"
      >
        <Icon v-if="item.icon" :name="item.icon" :size="15" class="dd__item-icon" />
        <span class="dd__item-label">{{ item.label }}</span>
        <span v-if="item.hint" class="dd__item-hint">{{ item.hint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
}

.dd__caret {
  opacity: 0.7;
}

.dd__menu {
  position: absolute;
  top: calc(100% + 4px);
  z-index: var(--mc-z-dropdown);
  min-width: 216px;
  padding: var(--mc-space-1);
  background: var(--mc-bg-elevated);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  box-shadow: var(--mc-elev-overlay);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.dd__menu--right {
  right: 0;
}

.dd__menu--left {
  left: 0;
}

.dd__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  width: 100%;
  padding: var(--mc-space-2) var(--mc-space-3);
  border: none;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  color: var(--mc-text);
  font: inherit;
  font-size: var(--mc-text-sm);
  text-align: left;
  cursor: pointer;
}

.dd__item:hover:not(:disabled),
.dd__item:focus-visible {
  background: var(--mc-bg-hover);
}

.dd__item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dd__item--danger {
  color: var(--mc-danger-fg);
}

.dd__item-icon {
  color: var(--mc-text-muted);
  flex: none;
}

.dd__item-label {
  flex: 1;
}

.dd__item-hint {
  font-size: 11px;
  color: var(--mc-text-muted);
}
</style>
