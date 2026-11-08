import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Exam, ExamCompose } from '@/composables/use-exam-compose';

/** 考试设置表单（第③步折叠区）：时长、及格线、作答次数、乱序、公布答案、时段。 */
export interface ExamSettingsForm {
  title: string;
  durationMinutes: number;
  passScore: number;
  attemptLimit: number;
  shuffleQuestions: boolean;
  showAnswers: boolean;
  paperType: string;
  startAt: string;
  endAt: string;
}

export function useExamSettings({ compose }: { compose: ExamCompose }) {
  const toast = useToastStore();
  const settings = reactive<ExamSettingsForm>({
    title: '',
    durationMinutes: 60,
    passScore: 60,
    attemptLimit: 0,
    shuffleQuestions: false,
    showAnswers: true,
    paperType: 'fixed',
    startAt: '',
    endAt: '',
  });
  const settingsSaving = ref(false);

  function toStamp(local: string): number {
    if (!local) return 0;
    const t = new Date(local).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  }

  function toLocal(stamp: number | undefined): string {
    if (!stamp) return '';
    const d = new Date(stamp * 1000);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 考试详情加载后回填表单（与拆分前 loadExam 里的赋值逐项一致）。 */
  function hydrate(e: Exam): void {
    settings.title = e.title;
    settings.durationMinutes = Number(e.duration_minutes ?? 60);
    settings.passScore = Number(e.pass_score ?? 60);
    settings.attemptLimit = Number(e.attempt_limit ?? 0);
    settings.shuffleQuestions = Number(e.shuffle_questions ?? 0) === 1;
    settings.showAnswers = Number(e.show_answers ?? 1) === 1;
    settings.startAt = toLocal(Number(e.start_at ?? 0));
    settings.endAt = toLocal(Number(e.end_at ?? 0));
    settings.paperType = Number(e.end_at ?? 0) > 0 ? 'window' : 'fixed';
  }

  async function saveSettings(): Promise<void> {
    settingsSaving.value = true;
    try {
      await api.put(`/exams/${compose.examId}`, {
        courseId: compose.exam?.course_id ?? 0,
        title: settings.title.trim(),
        durationMinutes: settings.durationMinutes,
        passScore: settings.passScore,
        status: compose.exam?.status ?? 'draft',
        startAt: settings.paperType === 'window' ? toStamp(settings.startAt) : 0,
        endAt: settings.paperType === 'window' ? toStamp(settings.endAt) : 0,
        attemptLimit: settings.attemptLimit,
        shuffleQuestions: settings.shuffleQuestions,
        showAnswers: settings.showAnswers,
      });
      toast.success(`考试设置已保存（${settings.durationMinutes} 分钟 / ${settings.passScore} 分及格）`);
      await compose.loadExam();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      settingsSaving.value = false;
    }
  }

  return reactive({ settings, settingsSaving, saveSettings, hydrate });
}

export type ExamSettings = ReturnType<typeof useExamSettings>;
