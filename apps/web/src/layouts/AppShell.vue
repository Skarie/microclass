<script setup lang="ts">
/**
 * 应用外壳：顶部横向导航（对标中国大学 MOOC 的网站结构）
 *
 * 为什么改：原来的"左侧固定侧边栏 + 顶栏"是所有后台模板的经典形态（用户反馈"太经典/不喜欢"），
 * 而中国大学 MOOC 这类学习平台是**顶部横向导航**——一级导航在顶栏，管理功能收进下拉。
 * 附带好处：内容区不再被侧栏吃掉 ~220px，横向留白也可以收紧。
 *
 * 结构：
 *   [Logo] 首页 / 课程大厅 / 我的课程 / 错题本 / 个人中心，右侧：等级 | 主题 | 教学管理 | 我的 | 菜单(窄屏)
 *   --> 内容区（max-width 1200，留白收紧）
 *   --> 页脚
 * 窄屏（≤900px）：一级导航收进抽屉（菜单按钮），管理项在抽屉里可折叠。
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { useToastStore } from '@/stores/toast';
import { usePanelStore } from '@/stores/panel';
import { api } from '@/api/client';
import DropdownMenu from '@/components/DropdownMenu.vue';
import Icon from '@/components/Icon.vue';
import type { IconName } from '@/components/icons';
import type { Summary } from '@/api/types';

const appVersion = __APP_VERSION__;
const auth = useAuthStore();
const theme = useThemeStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();
const panel = usePanelStore();
const summary = ref<Summary | null>(null);
const mobileNavOpen = ref(false);
/* 抽屉里的"教学管理"默认收起：移动端 9 项太长，先给一级导航让位 */
const manageOpen = ref(false);

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

const studentNav: NavItem[] = [
  { to: '/', label: '首页', icon: 'grid' },
  { to: '/hall', label: '课程大厅', icon: 'hall' },
  { to: '/my-courses', label: '我的课程', icon: 'courses' },
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
/** 教学模式下的顶部导航：管理功能优先（学员视图则回到 studentNav） */
const adminNav: NavItem[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats' },
  { to: '/admin/analytics', label: '学情分析', icon: 'target' },
];
const navItems = computed(() => (panel.isAdminPanel.value ? adminNav : studentNav));

/** 切换面板：切到学员视图时，若正在管理页则回首页 */
function switchPanel(next: 'admin' | 'student'): void {
  panel.setMode(next);
  if (next === 'student' && route.path.startsWith('/admin')) {
    void router.push({ name: 'home' });
  }
  if (next === 'admin' && !route.path.startsWith('/admin')) {
    void router.push({ name: 'admin-overview' });
  }
}
const userName = computed(() => auth.user?.display_name || auth.user?.username || '我');
/** 顶栏"教学管理"下拉：key = 路由路径 */
const manageMenuItems = computed(() =>
  visibleManageNav.value.map((i) => ({ key: i.to, label: i.label, icon: i.icon })),
);
const userMenuItems = computed(() => [
  { key: 'me', label: '个人中心', icon: 'user' as IconName },
  { key: 'my-courses', label: '我的课程', icon: 'courses' as IconName },
  { key: 'wrong-book', label: '错题本', icon: 'wrong' as IconName },
  { key: 'theme', label: theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题', icon: 'moon' as IconName },
  { key: 'logout', label: '退出登录', danger: true },
]);

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/';
  return route.path === to || route.path.startsWith(`${to}/`);
}

async function logout(): Promise<void> {
  await auth.logout();
  toast.info('已退出登录');
  await router.push({ name: 'login' });
}

function onUserSelect(key: string): void {
  if (key === 'logout') {
    void logout();
    return;
  }
  if (key === 'theme') {
    theme.toggle();
    return;
  }
  void router.push(key);
  mobileNavOpen.value = false;
}

function onManageSelect(key: string): void {
  void router.push(key);
  mobileNavOpen.value = false;
}

onMounted(async () => {
  try {
    summary.value = await api.get<Summary>('/me/summary');
  } catch {
    summary.value = null;
  }
});
</script>

<template>
  <div class="shell">
    <a class="skip-link" href="#mc-main">跳到主要内容</a>

    <header class="topbar">
      <RouterLink class="brand" :to="{ name: 'home' }" aria-label="回到首页">
        <span class="brand__logo" aria-hidden="true">微</span>
        <span class="brand__name">{{ auth.siteName }}</span>
      </RouterLink>

      <!-- 一级导航：横向（对标 MOOC）；窄屏收进抽屉 -->
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

      <div class="mc-spacer" />

      <span v-if="summary" class="topbar__level" :title="`学习时长 ${summary.minutes} 分钟`">
        <Icon name="graduation" :size="14" />
        {{ summary.level }}
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
      <div v-if="panel.canSwitch.value" class="panel-switch" role="group" aria-label="切换面板">
        <button
          class="panel-switch__btn"
          :class="{ 'panel-switch__btn--on': panel.isAdminPanel.value }"
          type="button"
          :aria-pressed="panel.isAdminPanel.value"
          @click="switchPanel('admin')"
        >
          <Icon name="grid" :size="14" />
          教学管理
        </button>
        <button
          class="panel-switch__btn"
          :class="{ 'panel-switch__btn--on': !panel.isAdminPanel.value }"
          type="button"
          :aria-pressed="!panel.isAdminPanel.value"
          @click="switchPanel('student')"
        >
          <Icon name="user" :size="14" />
          学员视图
        </button>
      </div>

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
        :aria-label="mobileNavOpen ? '关闭菜单' : '打开菜单'"
        :aria-expanded="mobileNavOpen"
        @click="mobileNavOpen = !mobileNavOpen"
      >
        <Icon :name="mobileNavOpen ? 'close' : 'menu'" :size="20" />
      </button>
    </header>

    <!-- 窄屏抽屉：一级导航 + 教学管理（可折叠） -->
    <aside v-if="mobileNavOpen" class="drawer" aria-label="移动端导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        class="drawer__item"
        :class="{ 'drawer__item--active': isActive(item.to) }"
        :to="item.to"
        @click="mobileNavOpen = false"
      >
        <Icon :name="item.icon" :size="18" />
        {{ item.label }}
      </RouterLink>

      <template v-if="auth.isTeacher">
        <button class="drawer__group" type="button" :aria-expanded="manageOpen" @click="manageOpen = !manageOpen">
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
          @click="mobileNavOpen = false"
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
    <div v-if="mobileNavOpen" class="drawer-backdrop" @click="mobileNavOpen = false" />

    <main id="mc-main" class="content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" @refresh-summary="summary = null" />
      </RouterView>
    </main>

    <footer class="footer">
      <div class="footer__cols">
        <section class="footer__col">
          <h2 class="footer__title">微课堂</h2>
          <p class="footer__text">
            自托管轻量学习平台：课程视频、章节归类、课后练习与错题本一体，学习数据保存在你自己的机器上。
          </p>
        </section>
        <nav class="footer__col" aria-label="帮助与文档">
          <h2 class="footer__title">帮助</h2>
          <span class="footer__text">部署维护：docs/deploy.md</span>
          <span class="footer__text">视频与媒体目录：docs/video.md</span>
          <span class="footer__text">界面规范：docs/design-guidelines.md</span>
        </nav>
      </div>
      <div class="footer__bar">
        <span>微课堂 v{{ appVersion }} · 自托管部署</span>
        <span>数据仅存于本机；课程内容版权归各自权利人所有。</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: transparent;
}

/* 跳转链接：平时视觉隐藏，键盘聚焦时才出现（无障碍要求） */
.skip-link {
  position: absolute;
  top: var(--mc-space-2);
  left: var(--mc-space-2);
  z-index: var(--mc-z-toast);
  padding: var(--mc-space-2) var(--mc-space-3);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-elevated);
  color: var(--mc-text);
  box-shadow: var(--mc-shadow-md);
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: translateY(0);
}

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

.nav {
  display: flex;
  align-items: center;
  gap: var(--mc-space-1);
  margin-left: var(--mc-space-4);
}

.nav__item {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
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

/* 双面板切换器 */
.panel-switch {
  display: flex;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1);
  border-radius: var(--mc-radius);
  background: var(--mc-bg-sunken);
}

.panel-switch__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--mc-space-1);
  padding: var(--mc-space-1) var(--mc-space-2);
  border: 0;
  border-radius: var(--mc-radius-sm);
  background: transparent;
  font-size: var(--mc-text-xs);
  color: var(--mc-text-secondary);
  cursor: pointer;
  transition: var(--mc-transition-colors);
  white-space: nowrap;
}

.panel-switch__btn--on {
  background: var(--mc-bg-elevated);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-semibold);
  box-shadow: var(--mc-shadow-sm);
}

/* ---------- 内容区（留白收紧）---------- */
.content {
  flex: 1;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--mc-space-5) var(--mc-space-5) var(--mc-space-10);
}

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
  padding: var(--mc-space-3);
  border: 0;
  border-radius: var(--mc-radius);
  background: transparent;
  font-size: var(--mc-text-base);
  color: var(--mc-text-secondary);
  text-align: left;
  cursor: pointer;
}

.drawer__item--active {
  background: var(--mc-primary-soft);
  color: var(--mc-primary-fg);
  font-weight: var(--mc-font-medium);
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

/* ---------- 页脚 ---------- */
.footer {
  padding: var(--mc-space-6) var(--mc-space-5) var(--mc-space-5);
  border-top: 1px solid var(--mc-border);
  background: var(--mc-bg-elevated);
}

.footer__cols {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr);
  gap: var(--mc-space-8);
  max-width: 1200px;
  margin: 0 auto;
}

.footer__col {
  display: flex;
  flex-direction: column;
  gap: var(--mc-space-2);
  min-width: 0;
}

.footer__title {
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-font-semibold);
  color: var(--mc-text);
}

.footer__text {
  margin: 0;
  font-size: var(--mc-text-xs);
  line-height: var(--mc-leading-relaxed);
  color: var(--mc-text-muted);
}

.footer__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mc-space-2) var(--mc-space-6);
  max-width: 1200px;
  margin: var(--mc-space-4) auto 0;
  padding-top: var(--mc-space-3);
  border-top: 1px solid var(--mc-border);
  font-size: var(--mc-text-xs);
  color: var(--mc-text-muted);
}

/* ---------- 窄屏：一级导航进抽屉 ---------- */
@media (max-width: 900px) {
  .topbar {
    padding: var(--mc-space-2) var(--mc-space-4);
  }

  .nav,
  .topbar__level,
  .topbar__manage,
  .panel-switch {
    display: none;
  }

  .topbar__menu {
    display: inline-flex;
  }

  .content {
    padding: var(--mc-space-4) var(--mc-space-4) var(--mc-space-8);
  }

  .footer__cols {
    grid-template-columns: 1fr;
    gap: var(--mc-space-4);
  }
}

/* 平板：仍然用顶栏导航，但把次要项收起 */
@media (min-width: 901px) and (max-width: 1080px) {
  .topbar__level {
    display: none;
  }

  .nav__item {
    padding: var(--mc-space-2);
  }
}
</style>
