<script setup lang="ts">
/**
 * 横向条形榜：把"排行/对比"做成一眼能比的条（知识点掌握度、学员错题数、高频错题错误率都用它）。
 *
 * 设计要点：
 *   - 主条表示"值 / 满值"，可再叠一条**参考条**（如错误率里的正确部分）；
 *   - 左侧图标 + 文字，右侧数值，中间是条，扫一眼就知道谁最差；
 *   - 支持点击（下钻），键盘可达（Enter/Space）；bar 是装饰，数值有文本，屏幕阅读器可读。
 */
import type { BarItem } from '@/components/charts/types';
import Icon from '@/components/Icon.vue';
import RichText from '@/components/RichText.vue';

const props = withDefaults(
  defineProps<{
    items: BarItem[];
    /** 只显示前 N 条 */
    limit?: number;
    /** 无障碍概述 */
    caption?: string;
    /** 可点击下钻 */
    clickable?: boolean;
  }>(),
  { limit: 0, caption: '', clickable: false },
);
const emit = defineEmits<{ select: [key: string | number] }>();

const shown = (): BarItem[] => (props.limit > 0 ? props.items.slice(0, props.limit) : props.items);

const maxOf = (item: BarItem): number => {
  if (item.max !== undefined && item.max > 0) return item.max;
  const values = props.items.map((i) => Math.abs(i.value));
  return Math.max(...values, 1);
};

const widthOf = (item: BarItem): number => {
  const max = maxOf(item);
  if (max <= 0) return 0;
  return Math.min(100, Math.max(2, (Math.abs(item.value) / max) * 100));
};
</script>

<template>
  <div class="bars" role="list" :aria-label="caption || '条形对比图'">
    <component
      :is="clickable ? 'button' : 'div'"
      v-for="item in shown()"
      :key="item.key"
      class="bars__row"
      :class="{ 'bars__row--clickable': clickable }"
      role="listitem"
      :type="clickable ? 'button' : undefined"
      @click="clickable && emit('select', item.key)"
    >
      <span class="bars__label">
        <Icon v-if="item.icon" :name="item.icon" :size="15" class="bars__icon" />
        <RichText v-if="item.richText" inline class="bars__text" :text="item.label" />
        <span v-else class="bars__text">{{ item.label }}</span>
      </span>
      <span class="bars__track">
        <span
          class="bars__fill"
          :class="`bars__fill--${item.tone ?? 'primary'}`"
          :style="{ width: `${widthOf(item)}%` }"
        />
        <span
          v-if="item.overlay !== undefined"
          class="bars__overlay"
          :style="{ width: `${Math.min(100, Math.max(0, item.overlay * 100))}%` }"
        />
      </span>
      <span class="bars__value">{{ item.valueText ?? item.value }}</span>
      <span v-if="item.hint" class="bars__hint">{{ item.hint }}</span>
    </component>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bars__row {
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) minmax(80px, 1.6fr) 64px minmax(0, 1fr);
  align-items: center;
  gap: var(--mc-space-2);
  padding: 4px 6px;
  border-radius: var(--mc-radius-sm);
  text-align: left;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
}

.bars__row--clickable {
  cursor: pointer;
}

.bars__row--clickable:hover {
  background: var(--mc-bg-sunken);
}

.bars__label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.bars__icon {
  flex: none;
  color: var(--mc-text-muted);
}

.bars__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--mc-text-sm);
}

.bars__track {
  position: relative;
  height: 14px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-bg-sunken);
  overflow: hidden;
}

.bars__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
}

.bars__fill--success {
  background: var(--mc-success);
}

.bars__fill--warning {
  background: var(--mc-warning);
}

.bars__fill--danger {
  background: var(--mc-danger);
}

.bars__fill--info {
  background: var(--mc-chart-2);
}

.bars__fill--neutral {
  background: var(--mc-chart-6);
}

.bars__overlay {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--mc-overlay-light);
}

.bars__value {
  text-align: right;
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  font-variant-numeric: tabular-nums;
}

.bars__hint {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
