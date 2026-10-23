<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { useNavReveal, useShellNav } from '@/composables/use-shell-nav';

/**
 * 一级导航：横向排列，窄屏整体隐藏后由抽屉接管。
 * 标签不换行、导航横向滚动、高亮项自动滚入可视区（逻辑见 use-shell-nav）。
 */
const { navItems, isActive } = useShellNav();
useNavReveal();
</script>

<template>
  <nav class="nav" aria-label="主导航">
    <RouterLink
      v-for="item in navItems"
      :key="item.to"
      class="nav__item"
      :class="{ 'nav__item--active': isActive(item.to) }"
      :to="item.to"
    >
      <Icon class="nav__icon" :name="item.icon" :size="16" />
      <span class="nav__label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.nav {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-left: var(--mc-space-4);
  /* 窗口窄时导航本身横向滚动，而不是把每个标签挤成两行 */
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.nav::-webkit-scrollbar {
  display: none;
}

.nav__item {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  /* 标签永不换行：窄屏靠导航横向滚动，不把「课程管理」拆成「课程管/理」 */
  white-space: nowrap;
  flex: none;
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  font-size: var(--mc-text-sm);
  color: var(--mc-text-secondary);
  transition: var(--mc-transition-colors);
}

.nav__item:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.nav__item--active {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

@media (max-width: 900px) {
  .nav {
    display: none;
  }
}

@media (min-width: 901px) and (max-width: 1400px) {
  /* 中等宽度：收窄导航内边距与图标，尽量让全部页签一屏放下 */
  .nav {
    margin-left: var(--mc-space-2);
  }

  .nav__item {
    padding: var(--mc-space-2) var(--mc-space-2);
  }

  .nav__icon {
    display: none;
  }
}

@media (min-width: 901px) and (max-width: 1240px) {
  .nav__item {
    padding: var(--mc-space-2);
  }
}
</style>
