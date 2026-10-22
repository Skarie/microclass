import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Exam } from '@/api/types';

export interface ScoreRow {
  user_id: number;
  username: string;
  display_name: string;
  score: number;
  total: number;
  passed: 0 | 1;
  used_seconds: number;
  created_at: number;
}

export interface ScoreSummary {
  attempts: number;
  passed: number;
  pass_rate: number;
  avg: number;
  best: number;
  worst: number;
  avg_seconds: number;
}

export interface ScoresResponse {
  exam: Exam;
  rows: ScoreRow[];
  summary: ScoreSummary;
}

export interface ExamAdminScoreDeps {
  getSelectedExamId: () => number | null;
  getSelectedExam: () => Exam | null;
}

/** 成绩单：按当前选中的考试拉取 /exams/:id/scores，供右侧统计与成绩表使用 */
export function useExamAdminScores(deps: ExamAdminScoreDeps) {
  const toast = useToastStore();
  const scores = ref<ScoresResponse | null>(null);
  const scoresLoading = ref(false);

  async function loadScores(): Promise<void> {
    const examId = deps.getSelectedExamId();
    if (examId === null) return;
    scoresLoading.value = true;
    try {
      scores.value = await api.get<ScoresResponse>(`/exams/${examId}/scores`);
    } catch (e) {
      toast.error(errorMessage(e));
      scores.value = null;
    } finally {
      scoresLoading.value = false;
    }
  }

  async function exportScores(): Promise<void> {
    const exam = deps.getSelectedExam();
    if (!exam) return;
    try {
      await api.download(`/exams/${exam.id}/scores.csv`);
      toast.success(`「${exam.title}」成绩单已开始下载`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function clearScores(): void {
    scores.value = null;
  }

  return reactive({ scores, scoresLoading, loadScores, exportScores, clearScores });
}
