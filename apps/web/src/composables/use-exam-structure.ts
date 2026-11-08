import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import { CN_NUM, fmtScore, typeLabel } from '@/composables/use-exam-compose';
import type { Exam, ExamCompose } from '@/composables/use-exam-compose';
import type { ExamRandom } from '@/composables/use-exam-random';

/** 一道大题（名称 + 题型 + 每题分值），保存在 exams.structure。 */
export interface PaperSection {
  name: string;
  type: string;
  score: number;
  description: string;
}

/**
 * 第③步的试卷结构编辑：大题行、按大题统一分值、保存结构并刷分值、
 * 按题型自动生成大题骨架；考试详情里的 structure 回填也在这里。
 */
export function useExamStructure({ compose, random }: { compose: ExamCompose; random: ExamRandom }) {
  const toast = useToastStore();
  const sections = ref<PaperSection[]>([]);

  /** 一键把某个大题下所有题设为同一分值 */
  async function setSectionScore(name: string, score: number): Promise<void> {
    const list = compose.paper.filter((q) => (q.section || '未分组') === name);
    if (list.length === 0) return;
    compose.busy = true;
    try {
      for (const q of list) await api.put(`/exams/${compose.examId}/questions/${q.id}`, { score });
      toast.success(`已把「${name}」的 ${list.length} 道题设为 ${fmtScore(score)} 分`);
      await compose.loadPaper();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      compose.busy = false;
    }
  }

  async function saveStructure(): Promise<void> {
    compose.busy = true;
    try {
      const sum = random.targetRatio.easy + random.targetRatio.medium + random.targetRatio.hard;
      await api.put(`/exams/${compose.examId}/structure`, {
        structure: sections.value.filter((s) => s.name.trim() !== ''),
        ...(sum > 0
          ? {
              difficultyTarget: {
                easy: random.targetRatio.easy / sum,
                medium: random.targetRatio.medium / sum,
                hard: random.targetRatio.hard / sum,
              },
            }
          : {}),
        applyScores: true,
      });
      toast.success(`试卷结构已保存（${sections.value.filter((s) => s.name.trim() !== '').length} 个大题）`);
      await compose.loadPaper();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      compose.busy = false;
    }
  }

  function fillSectionsByType(): void {
    const byType = compose.blueprint?.stats.byType ?? [];
    sections.value = byType
      .filter((t) => t.count > 0)
      .map((t, i) => ({
        name: `${CN_NUM[i] ?? String(i + 1)}、${typeLabel(t.type)}`,
        type: t.type,
        score: t.count > 0 ? Math.round((t.score / t.count) * 10) / 10 : 0,
        description: '',
      }));
    toast.info('已按题型生成大题骨架，可改名称与每题分值后保存');
  }

  /** 考试详情里的 structure（JSON 字符串）→ 大题编辑行；解析失败按空处理。 */
  function hydrateSections(e: Exam): void {
    if (typeof e.structure !== 'string' || e.structure === '') return;
    try {
      const parsed = JSON.parse(e.structure) as {
        name?: string;
        type?: string;
        score?: number;
        description?: string;
      }[];
      sections.value = parsed.map((s) => ({
        name: String(s.name ?? ''),
        type: String(s.type ?? ''),
        score: Number(s.score) || 0,
        description: String(s.description ?? ''),
      }));
    } catch {
      sections.value = [];
    }
  }

  return reactive({
    sections,
    setSectionScore,
    saveStructure,
    fillSectionsByType,
    hydrateSections,
  });
}

export type ExamStructure = ReturnType<typeof useExamStructure>;
