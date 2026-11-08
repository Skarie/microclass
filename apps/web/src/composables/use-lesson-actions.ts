import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { askConfirm } from '@/composables/use-confirm';
import { useToastStore } from '@/stores/toast';
import type { Course, Lesson } from '@/api/types';
import type { AssignScope } from '@/composables/use-course-lessons';

/**
 * 课时动作：批量改绑弹窗、新建 / 编辑 / 知识点 / 上传视频弹窗、
 * 单条与批量删除。列表与勾选状态由 use-course-lessons 提供，页面以参数注入。
 */
export interface LessonActionDeps {
  getCourses: () => Course[];
  getSelectedIds: (scope: AssignScope) => number[];
  clearSelection: (scope: AssignScope) => void;
  refreshAll: () => Promise<void>;
}

export function useLessonActions(deps: LessonActionDeps) {
  const toast = useToastStore();

  const assignOpen = ref(false);
  const assigning = ref(false);
  const assignScope = ref<AssignScope>('orphans');
  const assignForm = reactive<{ courseId: number | '' | 'orphan'; groupName: string }>({ courseId: '', groupName: '' });

  const lessonFormOpen = ref(false);
  const editingLesson = ref<Lesson | null>(null);
  const knOpen = ref(false);
  const knLesson = ref<Lesson | null>(null);
  const uploadOpen = ref(false);

  /** 当前批量操作作用的课时 id */
  const assignIds = computed(() => deps.getSelectedIds(assignScope.value));

  function openAssign(scope: AssignScope): void {
    const ids = deps.getSelectedIds(scope);
    if (ids.length === 0) {
      toast.warning('请先勾选要改绑的课时');
      return;
    }
    assignScope.value = scope;
    assignForm.courseId = deps.getCourses()[0]?.id ?? '';
    assignForm.groupName = '';
    assignOpen.value = true;
  }

  function closeAssign(): void {
    assignOpen.value = false;
  }

  async function runAssign(): Promise<void> {
    if (assignForm.courseId === '') {
      toast.warning('请选择目标课程');
      return;
    }
    assigning.value = true;
    try {
      const movingOut = assignForm.courseId === 'orphan';
      const target = movingOut ? null : Number(assignForm.courseId);
      const groupName = assignForm.groupName.trim();
      const res = await api.post<{ ok: true; updated: number }>('/lessons/batch-assign', {
        lessonIds: assignIds.value,
        courseId: target,
        ...(groupName ? { groupName } : {}),
      });
      const courseName = movingOut
        ? '未归类'
        : (deps.getCourses().find((c) => c.id === target)?.name ?? `课程 #${target}`);
      toast.success(
        `已把 ${res.updated} 个课时改绑到「${courseName}」`,
        groupName ? `章节统一为「${groupName}」` : '章节保持原样',
      );
      assignOpen.value = false;
      deps.clearSelection(assignScope.value);
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      assigning.value = false;
    }
  }

  function openLessonCreate(): void {
    editingLesson.value = null;
    lessonFormOpen.value = true;
  }

  function openUpload(): void {
    uploadOpen.value = true;
  }

  function openLessonEdit(lesson: Lesson): void {
    editingLesson.value = lesson;
    lessonFormOpen.value = true;
  }

  function openLessonKnowledge(lesson: Lesson): void {
    knLesson.value = lesson;
    knOpen.value = true;
  }

  function closeLessonForm(): void {
    lessonFormOpen.value = false;
  }

  function closeKnowledge(): void {
    knOpen.value = false;
  }

  async function onLessonSaved(): Promise<void> {
    lessonFormOpen.value = false;
    await deps.refreshAll();
  }

  async function removeLesson(lesson: Lesson): Promise<void> {
    const ok = await askConfirm({
      title: '删除课时',
      message: `确定删除课时「${lesson.title}」吗？`,
      detail: '该课时的进度、练习记录与知识点会一并移除，且不可恢复。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del<{ ok: boolean }>(`/lessons/${lesson.id}`);
      toast.success(`课时「${lesson.title}」已删除`);
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeSelected(scope: AssignScope): Promise<void> {
    const ids = [...deps.getSelectedIds(scope)];
    if (ids.length === 0) {
      toast.warning('请先勾选要删除的课时');
      return;
    }
    const ok = await askConfirm({
      title: '批量删除课时',
      message: `确定删除选中的 ${ids.length} 个课时吗？`,
      detail: '进度与练习记录会一并移除，且不可恢复。',
      confirmText: `删除 ${ids.length} 个课时`,
      danger: true,
    });
    if (!ok) return;
    try {
      for (const id of ids) await api.del<{ ok: boolean }>(`/lessons/${id}`);
      toast.success(`已删除 ${ids.length} 个课时`);
      deps.clearSelection(scope);
      await deps.refreshAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function onUploaded(): Promise<void> {
    await deps.refreshAll();
  }

  /** 关闭上传弹窗时再刷一次（上传过程中已经刷过一次，这里兜底） */
  async function closeUpload(): Promise<void> {
    uploadOpen.value = false;
    await deps.refreshAll();
  }

  return reactive({
    assignOpen,
    assigning,
    assignScope,
    assignForm,
    lessonFormOpen,
    editingLesson,
    knOpen,
    knLesson,
    uploadOpen,
    assignIds,
    openAssign,
    closeAssign,
    runAssign,
    openLessonCreate,
    openLessonEdit,
    openLessonKnowledge,
    closeLessonForm,
    closeKnowledge,
    openUpload,
    refreshAll: deps.refreshAll,
    onLessonSaved,
    removeLesson,
    removeSelected,
    onUploaded,
    closeUpload,
  });
}
