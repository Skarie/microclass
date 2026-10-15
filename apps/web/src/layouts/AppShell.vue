<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { useToastStore } from '@/stores/toast';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import Tag from '@/components/Tag.vue';
import type { IconName } from '@/components/icons';
import type { Summary } from '@/api/types';

const auth = useAuthStore();
const theme = useThemeStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();
const collapsed = ref(localStorage.getItem('microclass:sidebar') === '1');
const summary = ref<Summary | null>(null);
const mobileNavOpen = ref(false);

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

const studentNav: NavItem[] = [
  { to: '/', label: '课程大厅', icon: 'hall' },
  { to: '/wrong-book', label: '错题本', icon: 'wrong' },
  { to: '/me', label: '个人中心', icon: 'user' },
];

const manageNav: NavItem[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank' },
  { to: '/admin/question-conflicts', label: '冲突题核对', icon: 'conflict' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats' },
  { to: '/admin/analytics', label: '学情分析', icon: 'target' },
  { to: '/admin/users', label: '学员与账号', icon: 'users', adminOnly: true },
  { to: '/admin/settings', label: '系统设置', icon: 'settings', adminOnly: true },
];

const visibleManageNav = computed(() => manageNav.filter((i) => !i.adminOnly || auth.isAdmin));
const roleLabel = computed(() => (auth.isAdmin ? '管理员' : auth.isTeacher ? '教师' : '学员'));

function toggleSidebar(): void {
  collapsed.value = !collapsed.value;
  localStorage.setItem('microclass:sidebar', collapsed.value ? '1' : '0');
}

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/';
  return route.path === to || route.path.startsWith(`${to}/`);
}

async function logout(): Promise<void> {
  await auth.logout();
  toast.info('已退出登录');
  await router.push({ name: 'login' });
}

onMounted(async () => {
  try {
    summary.value = await api.get<Summary>('/me/summary');
  } catch {
    summary.value = null;
  }
});

const levelProgress = computed(() => {
  const s = summary.value;
  if (!s) return 0;
  if (s.nextMinutes === null) return 100;
  const prev = [0, 10, 60, 180, 420].filter((m) => m <= s.minutes).pop() ?? 0;
  const span = s.nextMinutes - prev;
  return span <= 0 ? 100 : Math.min(100, Math.round(((s.minutes - prev) / span) * 100));
});
</script>

<template>
  <div class="shell" :class="{ 'shell--collapsed': collapsed }">
    <aside class="sidebar" :class="{ 'sidebar--open': mobileNavOpen }">
      <div class="brand">
        <span class="brand__logo" aria-hidden="true">微</span>
        <span v-if="!collapsed" class="brand__name">{{ auth.siteName }}</span>
      </div>

      <nav class="nav" aria-label="主导航">
        <template v-for="item in studentNav" :key="item.to">
          <RouterLink
            class="nav__item"
            :class="{ 'nav__item--active': isActive(item.to) }"
            :to="item.to"
            :title="collapsed ? item.label : undefined"
            @click="mobileNavOpen = false"
          >
            <Icon class="nav__icon" :name="item.icon" :size="17" />
            <span v-if="!collapsed" class="nav__label">{{ item.label }}</span>
          </RouterLink>
        </template>

        <div v-if="auth.isTeacher" class="nav__group">
          <span v-if="!collapsed" class="nav__group-title">教学管理</span>
          <RouterLink
            v-for="item in visibleManageNav"
            :key="item.to"
            class="nav__item"
            :class="{ 'nav__item--active': isActive(item.to) }"
            :to="item.to"
            :title="collapsed ? item.label : undefined"
            @click="mobileNavOpen = false"
          >
            <Icon class="nav__icon" :name="item.icon" :size="17" />
            <span v-if="!collapsed" class="nav__label">{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>

      <div v-if="summary && !collapsed" class="level-card">
        <div class="level-card__head">
          <Icon name="graduation" :size="16" />
          <span class="level-card__name">{{ summary.level }}</span>
          <span class="level-card__minutes">{{ summary.minutes }} 分钟</span>
        </div>
        <ProgressBar :value="levelProgress" size="sm" />
        <div class="level-card__hint">
          <template v-if="summary.nextMinutes !== null"
            >再学 {{ Math.max(0, summary.nextMinutes - summary.minutes) }} 分钟升级</template
          >
          <template v-else>已达成最高等级</template>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button
          class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon topbar__menu"
          type="button"
          aria-label="展开导航"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <Icon name="menu" :size="18" />
        </button>
        <button
          class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
          type="button"
          :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="toggleSidebar"
        >
          <Icon :name="collapsed ? 'chevron-right' : 'chevron-left'" :size="18" />
        </button>
        <!-- 顶栏标题是"我在哪"的上下文提示；页面主标题由 PageHeader 的 h1 承担，避免一页两个 h1 -->
        <span class="topbar__title">{{ route.meta.title ?? '' }}</span>
        <div class="mc-spacer" />
        <button
          class="mc-btn mc-btn--ghost mc-btn--sm mc-btn--icon"
          type="button"
          :aria-label="theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          :title="theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          @click="theme.toggle()"
        >
          <Icon :name="theme.resolved === 'dark' ? 'sun' : 'moon'" :size="18" />
        </button>
        <div class="user">
          <span class="user__avatar" aria-hidden="true">{{ (auth.displayName || '?').slice(0, 1) }}</span>
          <span class="user__meta">
            <!-- 昵称与角色同名时（真机上管理员昵称就叫"管理员"）不重复显示 -->
            <span v-if="auth.displayName !== roleLabel" class="user__name">{{ auth.displayName }}</span>
            <Tag :tone="auth.isAdmin ? 'danger' : auth.isTeacher ? 'primary' : 'neutral'" size="sm">{{
              roleLabel
            }}</Tag>
          </span>
          <button class="mc-btn mc-btn--ghost mc-btn--sm" type="button" @click="logout">退出</button>
        </div>
      </header>

      <main id="mc-main" class="content">
        <RouterView v-slot="{ Component }">
          <component :is="Component" @refresh-summary="summary = null" />
        </RouterView>
      </main>
    </div>

    <div v-if="mobileNavOpen" class="sidebar-backdrop" @click="mobileNavOpen = false" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100%;
  /* 保留透明：让 body 的品牌氛围光晕透出来（写 --mc-bg 会把它盖掉） */
  background: transparent;
}

.sidebar {
  width: var(--mc-sidebar-width);
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-4);
  padding: var(--mc-space-4) var(--mc-space-3);
  background: var(--mc-glass-bg);
  -webkit-backdrop-filter: var(--mc-glass-blur);
  backdrop-filter: var(--mc-glass-blur);
  border-right: 1px solid var(--mc-border);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width var(--mc-transition);
}

/* 墨卷：侧栏不加渐隐光晕，靠色块与细分隔线区分区域 */

.shell--collapsed .sidebar {
  width: var(--mc-sidebar-collapsed);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding: 0 var(--mc-space-2);
}

.brand__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mc-radius-sm);
  background: var(--mc-primary);
  color: var(--mc-text-inverse);
  font-weight: 700;
  flex: none;
}

.brand__name {
  font-size: var(--mc-text-md);
  font-weight: 600;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav__group {
  margin-top: var(--mc-space-4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav__group-title {
  padding: var(--mc-space-2) var(--mc-space-3);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
  letter-spacing: 0.04em;
}

.nav__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius-md);
  color: var(--mc-text-secondary);
  font-size: var(--mc-text-sm);
  transition: var(--mc-transition-all);
}

.nav__item:hover {
  background: var(--mc-bg-hover);
  color: var(--mc-text);
}

/* 活动项：浅底 + 左侧主色细条（比整块实心色更克制、更"编辑"，也避免模板感） */
.nav__item--active {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
  box-shadow: inset 2px 0 0 var(--mc-primary);
}

.nav__icon {
  color: currentcolor;
  opacity: 0.9;
  flex: none;
}

.nav__item--active .nav__icon {
  opacity: 1;
}

.level-card {
  margin-top: auto;
  padding: var(--mc-space-3);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius-xl);
  box-shadow: var(--mc-shadow-sm);
  background-image: linear-gradient(140deg, var(--mc-primary-soft) 0%, var(--mc-bg-sunken) 62%);
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
}

.level-card__head {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  color: var(--mc-primary-fg);
}

.level-card__name {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.level-card__minutes {
  margin-left: auto;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.level-card__hint {
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: var(--mc-z-sticky);
  height: var(--mc-topbar-height);
  display: flex;
  align-items: center;
  gap: var(--mc-space-3);
  padding: 0 var(--mc-space-5);
  background: var(--mc-glass-bg);
  -webkit-backdrop-filter: var(--mc-glass-blur);
  backdrop-filter: var(--mc-glass-blur);
  border-bottom: 1px solid var(--mc-border);
}

.topbar__title {
  font-size: var(--mc-text-lg);
}

.topbar__menu {
  display: none;
}

.user {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  padding-left: var(--mc-space-2);
  border-left: 1px solid var(--mc-border);
}

.user__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mc-radius-pill);
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
  flex: none;
}

.user__meta {
  display: flex;
  align-items: center;
  gap: var(--mc-space-2);
  min-width: 0;
}

.user__name {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-medium);
  max-width: 12ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  flex: 1;
  width: 100%;
  max-width: var(--mc-content-max);
  margin: 0 auto;
  padding: var(--mc-space-6) var(--mc-space-5) var(--mc-space-12);
}

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--mc-z-dropdown);
  background: var(--mc-overlay);
}

@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    z-index: var(--mc-z-sticky);
    transform: translateX(-100%);
    width: var(--mc-sidebar-width) !important;
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .topbar__menu {
    display: inline-flex;
  }

  .content {
    padding: var(--mc-space-4) var(--mc-space-3) var(--mc-space-10);
  }
}
</style>
