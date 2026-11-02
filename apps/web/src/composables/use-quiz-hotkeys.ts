import { onBeforeUnmount, onMounted } from 'vue';
import type { QuestionView, QuizSubmitResult } from '@/api/types';

interface QuizHotkeysDeps {
  current: () => QuestionView | undefined;
  result: () => QuizSubmitResult | null;
  choose: (value: string) => void;
  next: () => void;
  prev: () => void;
  /** 答题卡抽屉打开时不抢键 */
  blocked: () => boolean;
}

/** 输入框/文本域/下拉/可编辑区：不抢键（沿用观看页做法） */
function isTypingTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['radio', 'checkbox'].includes((target as HTMLInputElement).type);
}

/**
 * 刷题快捷键：←/→ 上一题/下一题、A–D 选择选项（多选切换、判断 A=对 B=错）、Enter 下一题。
 * 选项是 radio/checkbox 时仍接管方向键（preventDefault 阻止原生选项切换），
 * 但按钮聚焦时的 Enter 留给按钮自身（交卷/答题卡）。
 */
export function useQuizHotkeys(deps: QuizHotkeysDeps) {
  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (isTypingTarget(target) || deps.blocked()) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      deps.prev();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      deps.next();
      return;
    }
    if (e.key === 'Enter') {
      if (target?.tagName === 'BUTTON' || target?.tagName === 'A') return;
      e.preventDefault();
      deps.next();
      return;
    }

    if (e.repeat) return;
    const letter = e.key.toUpperCase();
    if (!/^[A-D]$/.test(letter) || deps.result()) return;
    const q = deps.current();
    if (!q) return;
    if (q.type === 'judge') {
      if (letter !== 'A' && letter !== 'B') return;
      e.preventDefault();
      deps.choose(letter === 'A' ? 'T' : 'F');
      return;
    }
    if (q.type !== 'single' && q.type !== 'multiple') return;
    const index = letter.charCodeAt(0) - 65;
    if (index < 0 || index >= q.options.length) return;
    e.preventDefault();
    deps.choose(String(index));
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
