import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Lesson } from '@/api/types';

/**
 * 课时拖拽排序：拖拽后立即改本地数组，再提交给后端（失败则整体回滚）。
 * ↑ / ↓ 按钮与拖拽共用 moveTo，保证两套入口行为一致。
 */
interface OkResponse {
  ok: boolean;
}

export interface LessonOrderDeps {
  courseId: () => number;
  getLessons: () => Lesson[];
  setLessons: (lessons: Lesson[]) => void;
}

export function useLessonOrder(deps: LessonOrderDeps) {
  const toast = useToastStore();

  const dragging = ref<number | null>(null);
  const dragOver = ref<number | null>(null);
  const savingOrder = ref(false);

  function onDragStart(index: number, event: DragEvent): void {
    dragging.value = index;
    dragOver.value = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function onDragOver(index: number, event: DragEvent): void {
    if (dragging.value === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOver.value = index;
  }

  function onDragEnd(): void {
    dragging.value = null;
    dragOver.value = null;
  }

  async function onDrop(index: number): Promise<void> {
    const from = dragging.value;
    dragging.value = null;
    dragOver.value = null;
    if (from === null || from === index) return;
    await moveTo(from, index);
  }

  /** 把第 from 个课时移动到第 to 个位置（↑/↓ 按钮与拖拽共用） */
  async function moveTo(from: number, to: number): Promise<void> {
    const lessons = deps.getLessons();
    if (to < 0 || to >= lessons.length || from === to) return;
    const next = [...lessons];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const previous = lessons;
    deps.setLessons(next);
    savingOrder.value = true;
    try {
      await api.put<OkResponse>(`/courses/${deps.courseId()}/lessons/order`, { ids: next.map((l) => l.id) });
    } catch (e) {
      deps.setLessons(previous);
      toast.error(errorMessage(e));
    } finally {
      savingOrder.value = false;
    }
  }

  return reactive({
    dragging,
    dragOver,
    savingOrder,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
    moveTo,
  });
}
