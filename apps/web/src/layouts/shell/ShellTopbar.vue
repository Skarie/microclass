<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DropdownMenu from '@/components/DropdownMenu.vue';
import Icon from '@/components/Icon.vue';
import ShellNav from './ShellNav.vue';
import ShellPanelSwitch from './ShellPanelSwitch.vue';
import { useShellMenus } from '@/composables/use-shell-menus';
import { useAuthStore } from '@/stores/auth';
import { usePanelStore } from '@/stores/panel';
import { useThemeStore } from '@/stores/theme';
import type { Summary } from '@/api/types';
import { levelName } from '@/utils/level';

/**
 * 顶栏：品牌 + 一级导航 + 等级 / 主题 / 双面板切换 / 管理菜单 / 用户菜单 / 窄屏菜单按钮。
 * 各块样式随组件走；≤900px 时导航、等级、管理菜单、面板切换隐藏，菜单按钮出现。
 */
defineProps<{ summary: Summary | null; mobileOpen: boolean }>();
const emit = defineEmits<{ toggleDrawer: []; dismissDrawer: [] }>();

const auth = useAuthStore();
const theme = useThemeStore();
const panel = usePanelStore();
const { userName, manageMenuItems, userMenuItems, onUserSelect, onManageSelect } = useShellMenus({
  closeDrawer: () => emit('dismissDrawer'),
});
</script>

<template>
  <header class="topbar">
    <RouterLink class="brand" :to="{ name: 'home' }" aria-label="回到首页">
      <span class="brand__logo" aria-hidden="true">微</span>
      <span class="brand__name">{{ auth.siteName }}</span>
    </RouterLink>

    <!-- 一级导航：横向（对标 MOOC）；窄屏收进抽屉 -->
    <ShellNav />

    <div class="mc-spacer" />

    <span v-if="summary" class="topbar__level" :title="`学习时长 ${summary.minutes} 分钟`">
      <Icon name="graduation" :size="14" />
      {{ levelName(summary.level) }}
    </span>

    <button
      class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon topbar__icon"
      type="button"
      :aria-label="theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
      :title="theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
      @click="theme.toggle()"
    >
      <Icon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="18" />
    </button>

    <!-- 双面板切换：教学管理 / 学员视图（默认教学管理） -->
    <ShellPanelSwitch v-if="panel.canSwitch.value" />

    <DropdownMenu
      v-if="auth.isTeacher && panel.isAdminPanel.value"
      class="topbar__manage"
      :items="manageMenuItems"
      icon="grid"
      label="管理菜单"
      :align="'right'"
      @select="onManageSelect"
    />

    <DropdownMenu
      class="topbar__user"
      :items="userMenuItems"
      icon="user"
      :label="userName"
      :align="'right'"
      @select="onUserSelect"
    />

    <button
      class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon topbar__menu"
      type="button"
      :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'"
      :aria-expanded="mobileOpen"
      @click="emit('toggleDrawer')"
    >
      <Icon :name="mobileOpen ? 'close' : 'menu'" :size="20" />
    </button>
  </header>
</template>

<style scoped>
/* ---------- 顶栏 ---------- */
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--mc-z-sticky);
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-5);
  background: var(--mc-glass-bg);
  border-bottom: 1px solid var(--mc-border);
  -webkit-backdrop-filter: var(--mc-glass-blur);
  backdrop-filter: var(--mc-glass-blur);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-2);
  flex: none;
}

.brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
  color: var(--mc-neutral-0);
  font-weight: var(--mc-font-bold);
}

.brand__name {
  font-size: var(--mc-text-base);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.topbar__level {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-size: var(--mc-text-xs);
  white-space: nowrap;
}

.topbar__menu {
  display: none;
}

/* ---------- 窄屏：一级导航进抽屉 ---------- */
@media (max-width: 900px) {
  .topbar {
    padding: var(--mc-space-2) var(--mc-space-4);
  }

  .topbar__level,
  .topbar__manage {
    display: none;
  }

  .topbar__menu {
    display: inline-flex;
  }
}

/* 平板：仍然用顶栏导航，但把次要项收起 */
@media (min-width: 901px) and (max-width: 1100px) {
  /* 更窄的桌面/平板：只留 logo 图标，把横向空间让给导航页签 */
  .brand__name {
    display: none;
  }
}

@media (min-width: 901px) and (max-width: 1240px) {
  .topbar__level {
    display: none;
  }
}
</style>
