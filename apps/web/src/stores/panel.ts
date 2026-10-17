/**
 * 面板切换（仅管理员/教师可见）：
 *   admin   —— 教学管理面板（默认）：顶部导航是管理功能，落地页是总览
 *   student —— 学员视图：和学员完全一样（首页看板 / 课程大厅 / 我的课程 / 错题本 / 个人中心）
 *
 * 为什么做成"切换"而不是"按权限隐藏"：管理员本人也是使用者，需要能像学员一样
 * 走一遍学习流程（看课程、做题、看错题），但日常工作是管理。两个世界分开，互不干扰。
 */
import { computed, ref } from 'vue';
import { useAuthStore } from './auth';

const KEY = 'mc.panel';
export type PanelMode = 'admin' | 'student';

function readMode(): PanelMode {
  try {
    return window.localStorage.getItem(KEY) === 'student' ? 'student' : 'admin';
  } catch {
    return 'admin';
  }
}

const mode = ref<PanelMode>(readMode());

export function usePanelStore() {
  const auth = useAuthStore();
  /** 有管理权限的人才有双面板 */
  const canSwitch = computed(() => auth.isTeacher);
  /** 当前是否处于教学管理面板（没有权限的人永远是学员视图） */
  const isAdminPanel = computed(() => auth.isTeacher && mode.value === 'admin');

  function setMode(next: PanelMode): void {
    mode.value = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  function toggle(): void {
    setMode(isAdminPanel.value ? 'student' : 'admin');
  }

  return { mode, canSwitch, isAdminPanel, setMode, toggle };
}
