import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { ExamCompose, PaperQuestion } from '@/composables/use-exam-compose';

/** 卷面按"所属大题"分组后的展示结构。 */
export interface ComposeGroup {
  name: string;
  questions: PaperQuestion[];
  score: number;
}

export interface DifficultyItem {
  level: 'easy' | 'medium' | 'hard';
  actual: number;
  target: number;
  off: number;
}

/**
 * 第③步「看卷子」的题目列表与操作：分组、改分值、改所属大题、换序、删除、清空。
 * 大题结构的编辑在 useExamStructure；题目数据本身在 useExamCompose.loadPaper。
 */
export function useExamPaper({ compose }: { compose: ExamCompose }) {
  const toast = useToastStore();
  const expanded = ref<number[]>([]);

  const groups = computed<ComposeGroup[]>(() => {
    const map = new Map<string, PaperQuestion[]>();
    for (const q of compose.paper) {
      const key = q.section || '未分组';
      map.set(key, [...(map.get(key) ?? []), q]);
    }
    return [...map.entries()].map(([name, questions]) => ({
      name,
      questions,
      score: questions.reduce((s, q) => s + (Number(q.score) || 0), 0),
    }));
  });

  const totalScore = computed(() => compose.paper.reduce((s, q) => s + (Number(q.score) || 0), 0));
  const estimatedMinutes = computed(() => compose.blueprint?.stats.estimatedMinutes ?? 0);
  const qIndex = (id: number): number => compose.paper.findIndex((p) => p.id === id) + 1;
  const isOpen = (id: number): boolean => expanded.value.includes(id);

  function toggle(id: number): void {
    expanded.value = isOpen(id) ? expanded.value.filter((x) => x !== id) : [...expanded.value, id];
  }

  const difficultyCheck = computed<DifficultyItem[]>(() =>
    (['easy', 'medium', 'hard'] as const).map((level) => {
      const actual = Math.round((compose.blueprint?.target.actual[level] ?? 0) * 100);
      const target = Math.round((compose.blueprint?.target.ratio[level] ?? 0) * 100);
      return { level, actual, target, off: Math.abs(actual - target) };
    }),
  );

  async function setScore(q: PaperQuestion, score: number): Promise<void> {
    try {
      await api.put(`/exams/${compose.examId}/questions/${q.id}`, { score });
      await compose.loadPaper();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** 逐题改"所属大题"（老师常把某题从一组挪到另一组） */
  async function setSection(q: PaperQuestion, section: string): Promise<void> {
    try {
      await api.put(`/exams/${compose.examId}/questions/${q.id}`, { section });
      await compose.loadPaper();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeQuestion(q: PaperQuestion): Promise<void> {
    try {
      await api.del(`/exams/${compose.examId}/questions/${q.id}`);
      await Promise.all([compose.loadPaper(), compose.loadExam()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  /** 清空试卷（把题从这场考试移出，题目本身不删） */
  async function clearPaper(): Promise<void> {
    if (compose.paper.length === 0) return;
    const ok = await askConfirm({
      title: '清空试卷',
      message: `把试卷里的 ${compose.paper.length} 道题全部移出？`,
      detail: '只从这场考试移出，题目本身不会删除，之后仍可重新加入。',
      confirmText: '全部移出',
      danger: true,
    });
    if (!ok) return;
    compose.busy = true;
    try {
      for (const q of compose.paper) await api.del(`/exams/${compose.examId}/questions/${q.id}`);
      toast.success('试卷已清空');
      await Promise.all([compose.loadPaper(), compose.loadExam()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      compose.busy = false;
    }
  }

  async function removeById(id: number): Promise<void> {
    const q = compose.paper.find((p) => p.id === id);
    if (q) await removeQuestion(q);
  }

  /** 逐题换序（上移 / 下移一次交换相邻两条） */
  async function move(index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= compose.paper.length) return;
    const ids = compose.paper.map((q) => q.id);
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    try {
      await api.post(`/exams/${compose.examId}/questions/order`, { questionIds: ids });
      await compose.loadPaper();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return reactive({
    expanded,
    groups,
    totalScore,
    estimatedMinutes,
    qIndex,
    isOpen,
    toggle,
    difficultyCheck,
    setScore,
    setSection,
    removeQuestion,
    clearPaper,
    removeById,
    move,
  });
}

export type ExamPaper = ReturnType<typeof useExamPaper>;
