import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Exam } from '@/api/types';
import type { useExamAdminList } from './use-exam-admin-list';
import type { useExamAdminScores } from './use-exam-admin-scores';

interface OkIdResponse {
  ok: boolean;
  id: number;
}

interface OkResponse {
  ok: boolean;
}

export interface ExamFormState {
  title: string;
  description: string;
  durationMinutes: number;
  passScore: number;
  status: string;
}

export interface ExamAdminFormDeps {
  list: ReturnType<typeof useExamAdminList>;
  scores: ReturnType<typeof useExamAdminScores>;
}

/** 考试表单 + 单条考试的写操作（保存 / 发布 / 删除），接口与文案与原页面逐字一致 */
export function useExamAdminForm({ list, scores }: ExamAdminFormDeps) {
  const toast = useToastStore();
  const examFormOpen = ref(false);
  const examSaving = ref(false);
  const examEditingId = ref<number | null>(null);
  const examForm = reactive<ExamFormState>({
    title: '',
    description: '',
    durationMinutes: 60,
    passScore: 60,
    status: 'draft',
  });

  function openCreateExam(): void {
    if (list.courseId === '') {
      toast.warning('请先选择课程');
      return;
    }
    examEditingId.value = null;
    examForm.title = '';
    examForm.description = '';
    examForm.durationMinutes = 60;
    examForm.passScore = 60;
    examForm.status = 'draft';
    examFormOpen.value = true;
  }

  function openEditExam(exam: Exam): void {
    examEditingId.value = exam.id;
    examForm.title = exam.title;
    examForm.description = exam.description;
    examForm.durationMinutes = exam.duration_minutes;
    examForm.passScore = exam.pass_score;
    examForm.status = exam.status;
    examFormOpen.value = true;
  }

  async function saveExam(): Promise<void> {
    const title = examForm.title.trim();
    if (list.courseId === '') {
      toast.warning('请先选择课程');
      return;
    }
    if (!title) {
      toast.warning('请填写考试标题');
      return;
    }
    const payload = {
      courseId: Number(list.courseId),
      title,
      description: examForm.description.trim(),
      durationMinutes: Number(examForm.durationMinutes) || 60,
      passScore: Number(examForm.passScore) || 0,
      status: examForm.status,
    };
    examSaving.value = true;
    try {
      if (examEditingId.value === null) {
        const res = await api.post<OkIdResponse>('/exams', payload);
        toast.success(`考试「${title}」已创建，接下来请组卷`);
        examFormOpen.value = false;
        list.selectedExamId = res.id;
        await list.loadExams();
        await scores.loadScores();
      } else {
        await api.put<OkResponse>(`/exams/${examEditingId.value}`, payload);
        toast.success(`考试「${title}」已保存`);
        examFormOpen.value = false;
        await list.loadExams();
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      examSaving.value = false;
    }
  }

  async function togglePublish(exam: Exam): Promise<void> {
    const next: Exam['status'] = exam.status === 'published' ? 'draft' : 'published';
    const action = next === 'published' ? '发布' : '撤下';
    if (
      !window.confirm(
        `确定${action}考试「${exam.title}」吗？${next === 'published' ? '发布后学员即可在课程中看到并参加考试。' : '撤下后学员将无法再进入该考试。'}`,
      )
    ) {
      return;
    }
    try {
      await api.put<OkResponse>(`/exams/${exam.id}`, {
        courseId: exam.course_id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.duration_minutes,
        passScore: exam.pass_score,
        status: next,
      });
      toast.success(`考试「${exam.title}」已${action}`);
      await list.loadExams();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeExam(exam: Exam): Promise<void> {
    if (
      !window.confirm(
        `确定删除考试「${exam.title}」吗？试卷组卷与 ${exam.attempt_count ?? 0} 份作答成绩会一并删除，且不可恢复。`,
      )
    ) {
      return;
    }
    try {
      await api.del<OkResponse>(`/exams/${exam.id}`);
      toast.success(`考试「${exam.title}」已删除`);
      if (list.selectedExamId === exam.id) list.clearSelection();
      await list.loadExams();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return reactive({
    examFormOpen,
    examSaving,
    examEditingId,
    examForm,
    openCreateExam,
    openEditExam,
    saveExam,
    togglePublish,
    removeExam,
  });
}
