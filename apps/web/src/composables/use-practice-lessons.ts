/**
 * 关联弹窗里的课程 / 课时选择：先选课程（`/courses`），再按课程拉课时（`/lessons?course=`）。
 *
 * 全库有 3700+ 条课时，不能一次全拉；已选课时跨课程保留（支持一个目标关联多门课的课时）。
 * 已有关联课时不在当前课程列表里也能显示：标题从关联记录回填到 selectedTitles。
 */
import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/composables/useAsync';
import { useToastStore } from '@/stores/toast';
import type { PracticeLink } from '@/api/practice';
import type { Course, Lesson } from '@/api/types';

interface CoursesResponse {
  courses: Course[];
}
interface LessonsResponse {
  lessons: Lesson[];
}

export function usePracticeLessons() {
  const toast = useToastStore();
  const courses = ref<Course[]>([]);
  const courseId = ref<number | ''>('');
  const lessons = ref<Lesson[]>([]);
  const lessonsLoading = ref(false);
  const lessonKeyword = ref('');
  const selectedIds = ref<number[]>([]);
  const selectedTitles = reactive<Record<number, string>>({});
  let coursesLoaded = false;

  const visibleLessons = computed(() => {
    const keyword = lessonKeyword.value.trim().toLowerCase();
    if (keyword === '') return lessons.value;
    return lessons.value.filter((lesson) => `${lesson.title} ${lesson.group_name}`.toLowerCase().includes(keyword));
  });
  const selectedLessons = computed(() =>
    selectedIds.value.map((id) => ({ id, title: selectedTitles[id] ?? `课时 #${id}` })),
  );

  function isLessonSelected(id: number): boolean {
    return selectedIds.value.includes(id);
  }

  function toggleLesson(id: number): void {
    if (isLessonSelected(id)) {
      selectedIds.value = selectedIds.value.filter((item) => item !== id);
      return;
    }
    // 勾选时立刻记住标题：不然已选 chip 只能显示「课时 #id」
    const lesson = lessons.value.find((item) => item.id === id);
    if (lesson) selectedTitles[id] = lesson.title;
    selectedIds.value = [...selectedIds.value, id];
  }

  async function loadCourses(): Promise<void> {
    if (coursesLoaded) return;
    try {
      courses.value = (await api.get<CoursesResponse>('/courses')).courses;
      coursesLoaded = true;
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function loadLessons(id: number | ''): Promise<void> {
    courseId.value = id;
    if (id === '') {
      lessons.value = [];
      return;
    }
    lessonsLoading.value = true;
    try {
      lessons.value = (await api.get<LessonsResponse>('/lessons', { course: id })).lessons;
      for (const lesson of lessons.value) {
        if (isLessonSelected(lesson.id)) selectedTitles[lesson.id] = lesson.title;
      }
    } catch (e) {
      toast.error(errorMessage(e));
      lessons.value = [];
    } finally {
      lessonsLoading.value = false;
    }
  }

  /** 下拉切换课程（v-model 已更新 courseId） */
  function onCourseChange(): void {
    void loadLessons(typeof courseId.value === 'number' ? courseId.value : '');
  }

  /** 清空草稿：关键词、当前课程列表、已选课时与标题 */
  function resetDraft(): void {
    lessonKeyword.value = '';
    lessons.value = [];
    courseId.value = '';
    selectedIds.value = [];
    for (const key of Object.keys(selectedTitles)) delete selectedTitles[Number(key)];
  }

  /** 已有关联时回填已选课时（多课程也保留） */
  function seedFromLink(link: PracticeLink | null): void {
    if (!link) return;
    selectedIds.value = [...link.lessonIds];
    for (const lesson of link.lessons) selectedTitles[lesson.id] = lesson.title;
  }

  /** 打开弹窗时默认课程：优先已关联课时的课程，其次题库归属课程，最后第一门课 */
  function preferredCourseId(link: PracticeLink | null, hint: number | null): number | null {
    const fromLink = link?.lessons.find((lesson) => lesson.courseId !== null)?.courseId;
    return fromLink ?? hint ?? null;
  }

  return {
    courses,
    courseId,
    lessons,
    lessonsLoading,
    lessonKeyword,
    selectedIds,
    selectedLessons,
    visibleLessons,
    isLessonSelected,
    toggleLesson,
    loadCourses,
    loadLessons,
    onCourseChange,
    resetDraft,
    seedFromLink,
    preferredCourseId,
  };
}
