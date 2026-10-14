import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'microclass:theme';

/** 主题：浅色 / 深色 / 跟随系统，持久化到 localStorage */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system');
  const resolved = ref<'light' | 'dark'>('light');

  function apply(): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = mode.value === 'system' ? (prefersDark ? 'dark' : 'light') : mode.value;
    resolved.value = next;
    document.documentElement.dataset.theme = next;
  }

  function setMode(next: ThemeMode): void {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply();
  }

  function toggle(): void {
    setMode(resolved.value === 'dark' ? 'light' : 'dark');
  }

  /** 监听系统主题变化（仅在 system 模式下生效） */
  function init(): void {
    apply();
    watch(mode, apply);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (mode.value === 'system') apply();
    });
  }

  return { mode, resolved, setMode, toggle, init };
});
