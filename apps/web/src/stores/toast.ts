import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  detail?: string;
}

const MAX_VISIBLE = 3;
const TTL = 3500;

let seq = 0;

/** 轻提示：统一成功/失败反馈，避免各处 alert()；同屏最多 3 条，3.5s 自动收起 */
export const useToastStore = defineStore('toast', () => {
  const items = ref<Toast[]>([]);

  function remove(id: number): void {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function push(type: Toast['type'], message: string, detail?: string): number {
    seq += 1;
    const id = seq;
    items.value.push({ id, type, message, ...(detail ? { detail } : {}) });
    if (items.value.length > MAX_VISIBLE) items.value.shift();
    window.setTimeout(() => remove(id), TTL);
    return id;
  }

  const success = (message: string, detail?: string): number => push('success', message, detail);
  const error = (message: string, detail?: string): number => push('error', message, detail);
  const info = (message: string, detail?: string): number => push('info', message, detail);
  const warning = (message: string, detail?: string): number => push('warning', message, detail);

  return { items, push, remove, success, error, info, warning };
});
