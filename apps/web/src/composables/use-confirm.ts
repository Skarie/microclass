import { reactive } from 'vue';

/**
 * 全局确认弹窗：把各处 `window.confirm` 收敛成一个可样式化的 Promise 接口。
 *
 * - 一次只显示一条；后来的确认会先让前一条返回 false，避免 Promise 悬空；
 * - 组件只负责渲染，业务侧 `await askConfirm({...})` 拿布尔值；
 * - 危险操作在调用处显式传 `danger: true`，正文必须写清影响。
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  /** 第二段补充：不可恢复、关联数据如何处理等 */
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  detail: '',
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
});

let settle: ((ok: boolean) => void) | null = null;

/** 打开确认弹窗；用户确认返回 true，取消 / Esc / 点遮罩返回 false */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  if (settle) {
    settle(false);
    settle = null;
  }
  Object.assign(confirmState, {
    detail: '',
    confirmText: '确认',
    cancelText: '取消',
    danger: false,
    ...options,
    open: true,
  });
  return new Promise<boolean>((resolve) => {
    settle = resolve;
  });
}

export function settleConfirm(ok: boolean): void {
  confirmState.open = false;
  const resolve = settle;
  settle = null;
  resolve?.(ok);
}
