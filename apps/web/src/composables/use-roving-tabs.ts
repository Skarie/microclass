/**
 * 分段控件（role="tablist"）的键盘行为：←/→（↑/↓ 同样可用）在页签间移动并把焦点带过去。
 *
 * 为什么单独抽出来：全站有三处 tablist（学情分析页签、课程管理分区、题库目录视图切换），
 * 各写一份必然漂移；这里只提供「焦点怎么走」，选中逻辑仍由各组件自己 emit。
 */
import { ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';

export interface RovingTabs {
  setItem: (el: Element | ComponentPublicInstance | null, index: number) => void;
  onKeydown: (event: KeyboardEvent, index: number, select: (index: number) => void) => void;
}

export function useRovingTabs(count: () => number): RovingTabs {
  const items = ref<(HTMLElement | null)[]>([]);

  function setItem(el: Element | ComponentPublicInstance | null, index: number): void {
    items.value[index] = el instanceof HTMLElement ? el : null;
  }

  function onKeydown(event: KeyboardEvent, index: number, select: (index: number) => void): void {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    const total = count();
    if (total === 0) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + total) % total;
    select(next);
    // 等选中态渲染完再把焦点送过去，否则被选中的按钮在重渲染时丢焦点
    void Promise.resolve().then(() => items.value[next]?.focus());
  }

  return { setItem, onKeydown };
}
