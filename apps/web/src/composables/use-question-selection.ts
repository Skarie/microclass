/**
 * 题目选中与批量操作：本页全选、批量改难度、批量删除，以及表格行内的单条删除。
 *
 * 从 use-question-list 抽出。这里只管「选了谁」和「对选中的做什么」；
 * 动作完成后由列表组合式函数负责刷新（loadQuestions），题库计数由 loadBanks 刷新。
 * 单条删除也放这里：它和批量删除共用二次确认 + 删除后刷新列表/题库的流程。
 */
import { computed, ref, type Ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { difficultyLabel } from '@/composables/difficulty';
import type { QuestionView } from '@/api/types';

/** 难度档位：筛选 chip 与批量改难度菜单共用这一份定义 */
export const DIFFICULTY_OPTIONS: { value: 'easy' | 'medium' | 'hard'; label: string }[] = [
  { value: 'easy', label: '基础' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '较难' },
];

/** 选中与批量要用的列表状态：当前页题目、页码与刷新动作（由列表组合式函数提供） */
export interface QuestionSelectionDeps {
  selectedBankId: Ref<number | null>;
  questions: Ref<QuestionView[]>;
  page: Ref<number>;
  loadQuestions: () => Promise<void>;
  loadBanks: (keepSelection?: boolean) => Promise<void>;
}

export function useQuestionSelection(deps: QuestionSelectionDeps) {
  const toast = useToastStore();

  /** 多选：当前页选中的题目 id */
  const selectedIds = ref<Set<number>>(new Set());
  const selectedCount = computed(() => selectedIds.value.size);
  const allOnPageSelected = computed(
    () => deps.questions.value.length > 0 && deps.questions.value.every((q) => selectedIds.value.has(q.id)),
  );

  function toggleSelect(id: number): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
  }

  function toggleSelectAllOnPage(): void {
    if (allOnPageSelected.value) {
      selectedIds.value = new Set();
      return;
    }
    selectedIds.value = new Set(deps.questions.value.map((q) => q.id));
  }

  function clearSelection(): void {
    if (selectedIds.value.size > 0) selectedIds.value = new Set();
  }

  /** 批量改难度的菜单项（复用题型的难度档位定义） */
  const bulkDifficultyItems = DIFFICULTY_OPTIONS.map((d) => ({ key: d.value, label: d.label }));

  const bulkBusy = ref(false);

  /** 批量改难度：人工标注（重算难度不会覆盖），一次请求处理一页以内 */
  async function bulkSetDifficulty(difficulty: 'easy' | 'medium' | 'hard'): Promise<void> {
    const bankId = deps.selectedBankId.value;
    const ids = [...selectedIds.value];
    if (bankId === null || ids.length === 0) return;
    bulkBusy.value = true;
    try {
      const res = await api.post<{ updated: number; skipped: number }>(`/banks/${bankId}/questions/bulk-difficulty`, {
        ids,
        difficulty,
      });
      toast.success(`已把 ${res.updated} 道题标为「${difficultyLabel(difficulty)}」`);
      clearSelection();
      await deps.loadQuestions();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulkBusy.value = false;
    }
  }

  /** 批量删除：不可恢复，二次确认 */
  async function bulkDelete(): Promise<void> {
    const bankId = deps.selectedBankId.value;
    const ids = [...selectedIds.value];
    if (bankId === null || ids.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 道题吗？删除后不可恢复。`)) return;
    bulkBusy.value = true;
    try {
      const res = await api.post<{ deleted: number; skipped: number }>(`/banks/${bankId}/questions/bulk-delete`, {
        ids,
      });
      toast.success(`已删除 ${res.deleted} 道题`);
      clearSelection();
      await deps.loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      bulkBusy.value = false;
    }
  }

  /** 单条删除：删的是当前页最后一道且不在第一页时，回退一页（避免停在空页） */
  async function removeQuestion(question: QuestionView): Promise<void> {
    const preview = question.stem.length > 20 ? `${question.stem.slice(0, 20)}…` : question.stem;
    if (!window.confirm(`确定删除题目「${preview}」吗？该题目会从题库和已组试卷中移除。`)) return;
    try {
      await api.del<{ ok: boolean }>(`/questions/${question.id}`);
      toast.success('题目已删除');
      if (deps.questions.value.length === 1 && deps.page.value > 1) deps.page.value -= 1;
      await deps.loadQuestions();
      await deps.loadBanks();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return {
    selectedIds,
    selectedCount,
    allOnPageSelected,
    toggleSelect,
    toggleSelectAllOnPage,
    clearSelection,
    bulkDifficultyItems,
    bulkBusy,
    bulkSetDifficulty,
    bulkDelete,
    removeQuestion,
    DIFFICULTY_OPTIONS,
  };
}
