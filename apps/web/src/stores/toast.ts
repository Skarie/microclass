import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  detail?: string;
}

let seq = 0;

/** 轻提示：统一成功/失败反馈，避免各处 alert() */
export const useToastStore = defineStore('toast', () => {
  const items = ref<Toast[]>([]);

  function push(type: Toast['type'], message: string, detail?: string): number {
    seq += 1;
    const id = seq;
    items.value.push({ id, type, message, ...(detail ? { detail } : {}) });
    const ttl = type === 'error' ? 6000 : 3200;
    window.setTimeout(() => remove(id), ttl);
    return id;
  }

  function remove(id: number): void {
    items.value = items.value.filter((t) => t.id !== id);
  }

  const success = (message: string, detail?: string): number => push('success', message, detail);
  const error = (message: string, detail?: string): number => push('error', message, detail);
  const info = (message: string, detail?: string): number => push('info', message, detail);
  const warning = (message: string, detail?: string): number => push('warning', message, detail);

  return { items, push, remove, success, error, info, warning };
});
