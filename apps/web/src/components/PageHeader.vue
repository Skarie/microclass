<script setup lang="ts">
/**
 * 页头：标题 + 描述 + 面包屑 + 操作区。
 *
 * 为什么要有：审计发现 18 个页面各自手写"标题 + 说明 + 右上按钮"的块，
 * 结果间距、字号、按钮位置各不相同 —— 这是"看起来素/不专业"的主要来源之一。
 */
import Icon from './Icon.vue';
import type { IconName } from './icons';

withDefaults(
  defineProps<{
    title: string;
    description?: string;
    icon?: IconName;
    /** 面包屑（最后一项为当前页，不带 to） */
    breadcrumb?: { label: string; to?: string }[];
  }>(),
  { description: '', icon: undefined, breadcrumb: () => [] },
);
</script>

<template>
  <header class="ph">
    <nav v-if="breadcrumb.length > 0" class="ph__crumbs" aria-label="面包屑">
      <template v-for="(c, i) in breadcrumb" :key="i">
        <RouterLink v-if="c.to" class="ph__crumb" :to="c.to">{{ c.label }}</RouterLink>
        <span v-else class="ph__crumb ph__crumb--current" aria-current="page">{{ c.label }}</span>
        <Icon v-if="i < breadcrumb.length - 1" name="chevron-right" :size="14" class="ph__sep" />
      </template>
    </nav>

    <div class="ph__main">
      <div class="ph__text">
        <h1 class="ph__title">
          <span v-if="icon" class="ph__icon"><Icon :name="icon" :size="22" /></span>
          {{ title }}
        </h1>
        <p v-if="description" class="ph__desc">{{ description }}</p>
        <slot />
      </div>
      <div v-if="$slots.actions" class="ph__actions">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="$slots.meta" class="ph__meta">
      <slot name="meta" />
    </div>
  </header>
</template>

<style scoped>
.ph {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-3);
  margin-bottom: var(--mc-section-gap);
}

.ph__crumbs {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* 面包屑链接给足点击区（原来只有文字高度 19px，触屏点不准；WCAG 2.2 最小目标 24px） */
.ph__crumb {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 2px;
  color: var(--mc-text-muted);
}

.ph__crumb:hover {
  color: var(--mc-primary-fg);
}

.ph__crumb--current {
  color: var(--mc-text-secondary);
  font-weight: var(--mc-font-medium);
}

.ph__sep {
  color: var(--mc-border-strong);
}

.ph__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mc-space-5);
  flex-wrap: wrap;
}

.ph__text {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  min-width: 0;
}

.ph__title {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  font-size: var(--mc-text-2xl);
  line-height: var(--mc-leading-tight);
  letter-spacing: var(--mc-tracking-tight);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.ph__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--mc-radius);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  flex: none;
}

.ph__desc {
  margin: 0;
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  max-width: 76ch;
}

.ph__actions {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex-wrap: wrap;
}

.ph__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-3);
}
</style>
