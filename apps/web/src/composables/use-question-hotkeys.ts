/**
 * 题目表格的行级交互：键盘流（↑↓ / Enter / Esc）、题干展开与显示偏好。
 *
 * 从 use-question-list 抽出。表格组件自己只挂事件（@keydown），
 * 高亮行、展开集合、行密度与「显示元信息」开关这些状态都放这里。
 * "/" 聚焦搜索是页面级监听，它直接写本文件暴露的 keywordInput ref。
 * 行内还用到两个纯展示函数：难度悬停说明（difficultyTitle）与答案文本（answerText）。
 */
import { computed, ref, watch, type Ref } from 'vue';
import { difficultyLabel, difficultySourceLabel } from '@/composables/difficulty';
import { answerText } from '@/utils/question-form';
import type { QuestionView } from '@/api/types';

/**
 * 题库管理显示偏好（localStorage 记住）：
 * 行密度 与 是否显示题目元信息 —— 老师审题喜欢紧凑、录题喜欢信息全，两种人都要照顾。
 */
const PREFS_KEY = 'mc.bank.prefs';

/** 表格交互要用的外部状态：当前页题目与「回车编辑」的回调 */
export interface QuestionHotkeysDeps {
  questions: Ref<QuestionView[]>;
  openEditQuestion: (question: QuestionView) => void;
}

export function useQuestionHotkeys(deps: QuestionHotkeysDeps) {
  /** 题干是否默认折叠（长题干限 3 行，点一下展开）：一屏能多看几道题 */
  const expandedStems = ref<Set<number>>(new Set());
  function isStemExpanded(id: number): boolean {
    return expandedStems.value.has(id);
  }
  function toggleStem(id: number): void {
    const next = new Set(expandedStems.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedStems.value = next;
  }

  /** 表格容器引用：点表格任意处让它获得焦点，↑↓ 就能直接用 */
  const tableWrap = ref<HTMLElement | null>(null);
  /** 键盘流：当前高亮的题目下标（-1 = 未选） */
  const activeRow = ref(-1);
  /** 搜索框引用：按 "/" 直接聚焦 */
  const keywordInput = ref<HTMLInputElement | null>(null);

  function resetActiveRow(): void {
    activeRow.value = -1;
  }

  function onTableKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (typing && event.key !== 'Escape') return;
    const count = deps.questions.value.length;
    if (count === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeRow.value = activeRow.value < 0 ? 0 : Math.min(count - 1, activeRow.value + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeRow.value = activeRow.value <= 0 ? 0 : activeRow.value - 1;
      return;
    }
    if (event.key === 'Enter' && activeRow.value >= 0) {
      event.preventDefault();
      const row = deps.questions.value[activeRow.value];
      if (row) deps.openEditQuestion(row);
      return;
    }
    if (event.key === 'Escape') activeRow.value = -1;
  }

  /** 悬停看细节：评分 / 来源 / 样本数（原来直接堆在行里，太吵） */
  function difficultyTitle(question: {
    difficulty?: string | null;
    difficulty_score?: number | null;
    difficulty_source?: string | null;
    difficulty_n?: number | null;
  }): string {
    const parts = [`难度 ${difficultyLabel(question.difficulty)}`];
    if ((question.difficulty_score ?? -1) > 0) parts.push(`${Math.round(question.difficulty_score ?? 0)}/100`);
    if (question.difficulty_source) parts.push(difficultySourceLabel(question.difficulty_source));
    if (question.difficulty_n) parts.push(`${question.difficulty_n} 次作答`);
    return parts.join(' · ');
  }

  const density = ref<'comfortable' | 'compact'>('comfortable');
  const showMeta = ref(true);

  function loadPrefs(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as {
        density?: 'comfortable' | 'compact';
        showMeta?: boolean;
      };
      if (raw.density === 'compact' || raw.density === 'comfortable') density.value = raw.density;
      if (typeof raw.showMeta === 'boolean') showMeta.value = raw.showMeta;
    } catch {
      /* 隐私模式读不到 localStorage：用默认值 */
    }
  }

  function savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ density: density.value, showMeta: showMeta.value }));
    } catch {
      /* 忽略 */
    }
  }

  watch([density, showMeta], savePrefs);

  /** 「显示」菜单项：一次点击切换一项 */
  const viewMenuItems = computed(() => [
    {
      key: 'density',
      label: density.value === 'compact' ? '行高：紧凑（点击切换为舒适）' : '行高：舒适（点击切换为紧凑）',
    },
    { key: 'meta', label: showMeta.value ? '隐藏题目难度/知识点' : '显示题目难度/知识点' },
  ]);

  function onViewMenu(key: string): void {
    if (key === 'density') density.value = density.value === 'compact' ? 'comfortable' : 'compact';
    else if (key === 'meta') showMeta.value = !showMeta.value;
  }

  return {
    expandedStems,
    isStemExpanded,
    toggleStem,
    tableWrap,
    activeRow,
    keywordInput,
    resetActiveRow,
    onTableKeydown,
    answerText,
    difficultyTitle,
    density,
    showMeta,
    viewMenuItems,
    onViewMenu,
    loadPrefs,
  };
}
