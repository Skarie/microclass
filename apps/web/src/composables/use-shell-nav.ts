/**
 * 应用外壳的导航配置与窄屏横向滚动的「当前页签自动滚入」。
 *
 * 从 AppShell 抽出时保持行为不变：
 *  - 一级导航（学员 / 教学管理）与「教学管理」下拉共用同一份配置；
 *  - 当前项判定沿用前缀匹配（`/admin/courses/1` 仍高亮「课程管理」）；
 *  - 切页后 nextTick 把高亮项滚进可视区；窗口 resize 时 120ms 防抖后重算。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { usePanelStore } from '@/stores/panel';
import type { IconName } from '@/components/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

export const studentNav: NavItem[] = [
  { to: '/', label: '首页', icon: 'grid' },
  { to: '/hall', label: '课程大厅', icon: 'hall' },
  { to: '/my-courses', label: '我的课程', icon: 'courses' },
  { to: '/wrong-book', label: '错题本', icon: 'wrong' },
  { to: '/me', label: '个人中心', icon: 'user' },
];

export const manageNav: NavItem[] = [
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

/** 教学模式下的顶部导航：管理功能优先（学员视图则回到 studentNav） */
export const adminNav: NavItem[] = [
  { to: '/admin/overview', label: '总览', icon: 'grid' },
  { to: '/admin/courses', label: '课程管理', icon: 'courses' },
  { to: '/admin/banks', label: '题库管理', icon: 'bank' },
  { to: '/admin/exams', label: '考试管理', icon: 'exam' },
  { to: '/admin/stats', label: '学习统计', icon: 'stats' },
  { to: '/admin/analytics', label: '学情分析', icon: 'target' },
];

export function useShellNav() {
  const auth = useAuthStore();
  const panel = usePanelStore();
  const route = useRoute();

  const visibleManageNav = computed(() => manageNav.filter((i) => !i.adminOnly || auth.isAdmin));
  const navItems = computed(() => (panel.isAdminPanel.value ? adminNav : studentNav));

  function isActive(to: string): boolean {
    if (to === '/') return route.path === '/';
    return route.path === to || route.path.startsWith(`${to}/`);
  }

  return { visibleManageNav, navItems, isActive };
}

/**
 * 导航在窄屏是横向滚动的：切页后把当前页签滚进可视区，避免高亮项被裁到屏幕外。
 * resize 后布局变化可能让高亮项再次越界，因此同样重算（与拆分前一致）。
 */
export function useNavReveal() {
  const route = useRoute();
  let navResizeTimer: ReturnType<typeof setTimeout> | null = null;

  function revealActiveNav(): void {
    const nav = document.querySelector<HTMLElement>('.nav');
    const active = nav?.querySelector<HTMLElement>('.nav__item--active');
    if (!nav || !active) return;
    active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'auto' });
  }

  function onWindowResize(): void {
    if (navResizeTimer) clearTimeout(navResizeTimer);
    navResizeTimer = setTimeout(revealActiveNav, 120);
  }

  watch(
    () => route.path,
    () => {
      void nextTick(revealActiveNav);
    },
  );

  onMounted(() => window.addEventListener('resize', onWindowResize));
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onWindowResize);
    if (navResizeTimer) clearTimeout(navResizeTimer);
  });
}
