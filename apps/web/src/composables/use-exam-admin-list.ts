import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Course, Exam } from '@/api/types';

interface CourseListResponse {
  courses: Course[];
}

interface CourseExamsResponse {
  course: { id: number; name: string };
  exams: Exam[];
}

/** 父页面把「选中考试后要做什么」注入进来，避免列表与成绩单互相 import */
export interface ExamAdminListHooks {
  /** 选中考试后加载右侧面板（成绩单） */
  loadActivePanel?: () => Promise<void>;
  /** 清空右侧面板 */
  clearPanels?: () => void;
}

/**
 * 考试管理左侧列表：课程下拉、考试列表、深链 ?exam=<id> 与选中状态。
 * 请求序号用于慢盘上丢弃「迟到的旧响应」，避免旧课程/旧考试的响应覆盖当前选择。
 */
export function useExamAdminList(hooks: ExamAdminListHooks = {}) {
  const route = useRoute();
  const toast = useToastStore();

  const courses = ref<Course[]>([]);
  const courseId = ref<number | ''>('');
  const exams = ref<Exam[]>([]);
  const examsLoading = ref(false);
  /** 请求序号：慢盘上丢弃「迟到的旧响应」，避免旧课程/旧考试的响应覆盖当前选择 */
  let examsSeq = 0;
  const selectedExamId = ref<number | null>(null);

  const selectedExam = computed(() => exams.value.find((e) => e.id === selectedExamId.value) ?? null);

  async function loadCourses(): Promise<void> {
    try {
      const res = await api.get<CourseListResponse>('/courses');
      courses.value = res.courses;
      const fromQuery = Number.parseInt(String(route.query.exam ?? ''), 10);
      if (Number.isNaN(fromQuery) && courseId.value === '' && res.courses.length > 0) {
        const first = res.courses[0];
        if (first) courseId.value = first.id;
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function loadExams(): Promise<void> {
    if (courseId.value === '') {
      exams.value = [];
      selectedExamId.value = null;
      return;
    }
    // 慢盘上（NAS 机械盘，一次读库要几秒）快速切课程时，先发的请求可能后回：
    // 例：默认课程 A 的考试列表还在路上，用户已经切到课程 B，A 的响应回来把 B 覆盖掉，
    // 界面跳回 A 的考试、连左栏题池都跟着变（真机复现，2026-09）。
    // 用序号 + 课程号双重判断，迟到的响应直接丢弃。
    const seq = ++examsSeq;
    const wanted = String(courseId.value);
    examsLoading.value = true;
    try {
      const res = await api.get<CourseExamsResponse>(`/courses/${wanted}/exams`);
      if (seq !== examsSeq || String(courseId.value) !== wanted) return;
      exams.value = res.exams;
      const stillThere = exams.value.some((e) => e.id === selectedExamId.value);
      if (!stillThere) selectedExamId.value = exams.value[0]?.id ?? null;
      if (selectedExamId.value !== null) await hooks.loadActivePanel?.();
      else hooks.clearPanels?.();
    } catch (e) {
      if (seq !== examsSeq || String(courseId.value) !== wanted) return;
      toast.error(errorMessage(e));
      exams.value = [];
      selectedExamId.value = null;
      hooks.clearPanels?.();
    } finally {
      if (seq === examsSeq) examsLoading.value = false;
    }
  }

  /** 清掉选中考试与右侧面板（删除当前考试时用） */
  function clearSelection(): void {
    selectedExamId.value = null;
    hooks.clearPanels?.();
  }

  async function selectExam(exam: Exam): Promise<void> {
    if (selectedExamId.value === exam.id) return;
    selectedExamId.value = exam.id;
    await hooks.loadActivePanel?.();
  }

  /** 深链 ?exam=<id>：逐门课程查找该考试并选中 */
  async function applyDeepLink(): Promise<void> {
    const wanted = Number.parseInt(String(route.query.exam ?? ''), 10);
    if (Number.isNaN(wanted) || courses.value.length === 0) return;
    for (const course of courses.value) {
      try {
        const res = await api.get<CourseExamsResponse>(`/courses/${course.id}/exams`);
        if (res.exams.some((e) => e.id === wanted)) {
          courseId.value = course.id;
          exams.value = res.exams;
          selectedExamId.value = wanted;
          await hooks.loadActivePanel?.();
          return;
        }
      } catch {
        // 单门课程失败不影响继续查找
      }
    }
    toast.warning('未找到指定的考试，可能已被删除');
  }

  return reactive({
    courses,
    courseId,
    exams,
    examsLoading,
    selectedExamId,
    selectedExam,
    loadCourses,
    loadExams,
    clearSelection,
    selectExam,
    applyDeepLink,
  });
}
