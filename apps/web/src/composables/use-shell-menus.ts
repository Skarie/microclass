/**
 * 顶栏「管理菜单 / 用户菜单」的数据与选择行为。
 *
 * 从 AppShell 抽出时保持行为不变：
 *  - 用户菜单的「主题」只切主题、「退出登录」只登出，二者都不关闭移动端抽屉；
 *  - 其余菜单项跳转后关闭抽屉（closeDrawer 由顶栏注入）。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { useToastStore } from '@/stores/toast';
import { useShellNav } from './use-shell-nav';
import type { IconName } from '@/components/icons';

export interface ShellMenuOptions {
  /** 选择普通导航项后关闭移动端抽屉 */
  closeDrawer?: () => void;
}

export function useShellMenus(options: ShellMenuOptions = {}) {
  const auth = useAuthStore();
  const theme = useThemeStore();
  const toast = useToastStore();
  const router = useRouter();
  const { visibleManageNav } = useShellNav();

  const userName = computed(() => auth.user?.display_name || auth.user?.username || '我');

  /** 顶栏"教学管理"下拉：key = 路由路径 */
  const manageMenuItems = computed(() =>
    visibleManageNav.value.map((i) => ({ key: i.to, label: i.label, icon: i.icon })),
  );

  const userMenuItems = computed(() => [
    { key: 'me', label: '个人中心', icon: 'user' as IconName },
    { key: 'my-courses', label: '我的课程', icon: 'courses' as IconName },
    { key: 'wrong-book', label: '错题本', icon: 'wrong' as IconName },
    {
      key: 'theme',
      label: theme.resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题',
      icon: 'moon' as IconName,
    },
    { key: 'logout', label: '退出登录', danger: true },
  ]);

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
    options.closeDrawer?.();
  }

  function onManageSelect(key: string): void {
    void router.push(key);
    options.closeDrawer?.();
  }

  return { userName, manageMenuItems, userMenuItems, logout, onUserSelect, onManageSelect };
}
