<script setup lang="ts">
/**
 * 分区标题：15px/600 + 可选前置小图标 + 右侧操作链接 / 计数。
 * 首页、课程大厅、后台区块共用这一套，标题与内容间距 12（靠组件内的 margin 保证）。
 */
import { RouterLink } from 'vue-router';
import Icon from './Icon.vue';
import type { IconName } from './icons';

withDefaults(
  defineProps<{
    title: string;
    icon?: IconName;
    /** 右侧文字入口；有 actionTo 渲染成链接，否则是按钮 */
    actionText?: string;
    actionTo?: string;
  }>(),
  { icon: undefined, actionText: '', actionTo: '' },
);
defineEmits<{ action: [] }>();
</script>

<template>
  <header class="sh">
    <h2 class="sh__title">
      <Icon v-if="icon" :name="icon" :size="16" class="sh__icon" />
      {{ title }}
    </h2>
    <span v-if="$slots.meta" class="sh__meta"><slot name="meta" /></span>
    <span class="mc-spacer" />
    <RouterLink v-if="actionText && actionTo" class="sh__action" :to="actionTo">
      {{ actionText }}
      <Icon name="chevron-right" :size="14" />
    </RouterLink>
    <button v-else-if="actionText" class="sh__action" type="button" @click="$emit('action')">
      {{ actionText }}
    </button>
  </header>
</template>

<style scoped>
.sh {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin-bottom: var(--mc-space-3);
}

.sh__title {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  margin: 0;
  font-size: var(--mc-text-md);
  font-weight: var(--mc-font-semibold);
  line-height: var(--mc-leading-tight);
  color: var(--mc-text);
}

.sh__icon {
  color: var(--mc-primary-fg);
}

.sh__meta {
  display: inline-flex;
  align-items: center;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.sh__action {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  min-height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mc-primary-fg);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.sh__action:hover {
  color: var(--mc-primary-hover);
  text-decoration: underline;
}

@media (max-width: 1023px) {
  /* 触控目标：右侧链接在移动端补足 44px */
  .sh__action {
    min-height: var(--mc-touch-target-mobile);
  }
}
</style>
