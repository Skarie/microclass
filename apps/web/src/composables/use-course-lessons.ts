import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { Lesson } from '@/api/types';

/**
 * 「全部课时 / 未归类课时」两个列表：加载、筛选、勾选。
 * 批量改绑、删除、课时弹窗在 use-lesson-actions，两者通过页面注入的
 * getSelectedIds / clearSelection 协作，模块内不保存全局单例。
 */
interface LessonListResponse {
  lessons: Lesson[];
}

/** 批量改绑 / 批量删除的作用域：全部课时 / 未归类课时 */
export type AssignScope = 'all' | 'orphans';

function toggleIn(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function useCourseLessons() {
  const toast = useToastStore();

  /* ---------------- 全部课时 ---------------- */
  const allLessons = ref<Lesson[]>([]);
  const allLoading = ref(false);
  const allSelectedIds = ref<number[]>([]);
  const lessonCourseFilter = ref<number | '' | 'orphan'>('');
  const lessonKeyword = ref('');

  const filteredLessons = computed(() => {
    const kw = lessonKeyword.value.trim().toLowerCase();
    return allLessons.value.filter((l) => {
      if (lessonCourseFilter.value === 'orphan') {
        if (l.course_id !== null) return false;
      } else if (lessonCourseFilter.value !== '' && l.course_id !== lessonCourseFilter.value) {
        return false;
      }
      if (!kw) return true;
      return `${l.title} ${l.group_name} ${l.video_path}`.toLowerCase().includes(kw);
    });
  });

  const emptyChapterCount = computed(() => allLessons.value.filter((l) => l.group_name === '').length);

  /* ---------------- 未归类课时 ---------------- */
  const orphanLessons = ref<Lesson[]>([]);
  const orphanLoading = ref(false);
  const orphanSelectedIds = ref<number[]>([]);

  async function loadAllLessons(): Promise<void> {
    allLoading.value = true;
    try {
      const res = await api.get<LessonListResponse>('/lessons');
      allLessons.value = res.lessons;
      allSelectedIds.value = allSelectedIds.value.filter((id) => res.lessons.some((l) => l.id === id));
    } catch (e) {
      toast.error(errorMessage(e));
      allLessons.value = [];
    } finally {
      allLoading.value = false;
    }
  }

  async function loadOrphans(): Promise<void> {
    orphanLoading.value = true;
    try {
      const res = await api.get<LessonListResponse>('/lessons', { course: 'orphan' });
      orphanLessons.value = res.lessons;
      orphanSelectedIds.value = orphanSelectedIds.value.filter((id) => res.lessons.some((l) => l.id === id));
    } catch (e) {
      toast.error(errorMessage(e));
      orphanLessons.value = [];
    } finally {
      orphanLoading.value = false;
    }
  }

  /* ---------------- 勾选 ---------------- */
  function toggleAllLesson(id: number): void {
    allSelectedIds.value = toggleIn(allSelectedIds.value, id);
  }

  function toggleAllLessonsAll(): void {
    const ids = filteredLessons.value.map((l) => l.id);
    allSelectedIds.value = allSelectedIds.value.length === ids.length ? [] : ids;
  }

  function toggleOrphan(id: number): void {
    orphanSelectedIds.value = toggleIn(orphanSelectedIds.value, id);
  }

  function toggleAllOrphans(): void {
    const ids = orphanLessons.value.map((l) => l.id);
    orphanSelectedIds.value = orphanSelectedIds.value.length === ids.length ? [] : ids;
  }

  function clearSelection(scope: AssignScope): void {
    if (scope === 'all') allSelectedIds.value = [];
    else orphanSelectedIds.value = [];
  }

  return reactive({
    allLessons,
    allLoading,
    allSelectedIds,
    lessonCourseFilter,
    lessonKeyword,
    filteredLessons,
    emptyChapterCount,
    orphanLessons,
    orphanLoading,
    orphanSelectedIds,
    loadAllLessons,
    loadOrphans,
    toggleAllLesson,
    toggleAllLessonsAll,
    toggleOrphan,
    toggleAllOrphans,
    clearSelection,
  });
}
