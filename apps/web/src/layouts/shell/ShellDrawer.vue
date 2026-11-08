<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '@/components/Icon.vue';
import { useShellMenus } from '@/composables/use-shell-menus';
import { useShellNav } from '@/composables/use-shell-nav';
import { useAuthStore } from '@/stores/auth';

/**
 * 窄屏抽屉：一级导航 + 教学管理（可折叠）+ 退出登录。
 * 折叠状态由 AppShell 持有（与拆分前一致：关掉抽屉再打开仍保持上次展开状态）。
 */
defineProps<{ manageOpen: boolean }>();
const emit = defineEmits<{ close: []; toggleManage: [] }>();

const auth = useAuthStore();
const { navItems, visibleManageNav, isActive } = useShellNav();
const { onUserSelect } = useShellMenus();
</script>

<template>
  <aside class="drawer" aria-label="移动端导航">
    <RouterLink
      v-for="item in navItems"
      :key="item.to"
      class="drawer__item"
      :class="{ 'drawer__item--active': isActive(item.to) }"
      :to="item.to"
      @click="emit('close')"
    >
      <Icon :name="item.icon" :size="18" />
      {{ item.label }}
    </RouterLink>

    <template v-if="auth.isTeacher">
      <button class="drawer__group" type="button" :aria-expanded="manageOpen" @click="emit('toggleManage')">
        <span>教学管理</span>
        <Icon :name="manageOpen ? 'minus' : 'plus'" :size="15" />
      </button>
      <RouterLink
        v-for="item in visibleManageNav"
        v-show="manageOpen"
        :key="item.to"
        class="drawer__item drawer__item--sub"
        :class="{ 'drawer__item--active': isActive(item.to) }"
        :to="item.to"
        @click="emit('close')"
      >
        <Icon :name="item.icon" :size="17" />
        {{ item.label }}
      </RouterLink>
    </template>

    <button class="drawer__item drawer__item--danger" type="button" @click="onUserSelect('logout')">
      <Icon name="close" :size="18" />
      退出登录
    </button>
  </aside>
  <div class="drawer-backdrop" @click="emit('close')" />
</template>

<style scoped>
/* ---------- 窄屏抽屉 ---------- */
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: var(--mc-z-modal);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-1);
  width: min(300px, 86vw);
  padding: var(--mc-space-4);
  overflow-y: auto;
  background: var(--mc-bg-elevated);
  box-shadow: var(--mc-shadow-lg);
}

.drawer__item {
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  /* 移动端菜单项统一 44px 触控目标 */
  min-height: var(--mc-touch-target-mobile);
  padding: var(--mc-space-3);
  border: 0;
  border-radius: var(--mc-radius);
  background: transparent;
  font-size: var(--mc-text-base);
  color: var(--mc-text-secondary);
  text-align: left;
  cursor: pointer;
  transition: var(--mc-transition-all);
}

.drawer__item:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

.drawer__item:active {
  transform: scale(var(--mc-press-scale-soft));
}

.drawer__item--active {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
}

.drawer__item--active:hover {
  background: var(--mc-primary-100);
  color: var(--mc-primary-hover);
}

.drawer__item--sub {
  padding-left: var(--mc-space-6);
  font-size: var(--mc-text-sm);
}

.drawer__item--danger {
  color: var(--mc-danger-fg);
}

.drawer__group {
  display: flex;
  min-height: var(--mc-touch-target-mobile);
  align-items: center;
  justify-content: space-between;
  padding: var(--mc-space-3);
  border: 0;
  background: transparent;
  font-size: var(--mc-text-xs);
  font-weight: var(--mc-font-semibold);
  letter-spacing: 0.06em;
  color: var(--mc-text-muted);
  cursor: pointer;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--mc-z-sticky);
  background: var(--mc-overlay);
}
</style>
